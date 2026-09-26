use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

use crate::codec::{resample_8k_mulaw_to_output, resample_input_to_8k_mulaw};

pub struct AudioEngine {
    output_queue: Arc<Mutex<VecDeque<f32>>>,
    pending_marks: Arc<Mutex<VecDeque<(usize, String)>>>,
    playback_epoch: Arc<AtomicU64>,
    stop_tx: Mutex<Option<oneshot::Sender<()>>>,
    out_rate: u32,
    out_channels: u16,
}

impl AudioEngine {
    pub fn start(
        mic_tx: mpsc::UnboundedSender<Vec<u8>>,
        mark_tx: mpsc::UnboundedSender<String>,
    ) -> Result<Self, String> {
        let output_queue = Arc::new(Mutex::new(VecDeque::<f32>::new()));
        let pending_marks = Arc::new(Mutex::new(VecDeque::<(usize, String)>::new()));
        let playback_epoch = Arc::new(AtomicU64::new(0));

        let queue_clone = Arc::clone(&output_queue);
        let marks_clone = Arc::clone(&pending_marks);

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(u32, u16), String>>();
        let (thread_stop_tx, thread_stop_rx) = oneshot::channel::<()>();

        std::thread::spawn(move || {
            let host = cpal::default_host();

            let input_device = match host.default_input_device() {
                Some(d) => d,
                None => {
                    let _ = ready_tx.send(Err("No audio input device available".to_string()));
                    return;
                }
            };

            let output_device = match host.default_output_device() {
                Some(d) => d,
                None => {
                    let _ = ready_tx.send(Err("No audio output device available".to_string()));
                    return;
                }
            };

            let in_default_config = match input_device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to get default input config: {e}")));
                    return;
                }
            };

            let out_default_config = match output_device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to get default output config: {e}")));
                    return;
                }
            };

            let in_rate = in_default_config.sample_rate().0;
            let in_channels = in_default_config.channels();
            let in_config = StreamConfig {
                channels: in_channels,
                sample_rate: cpal::SampleRate(in_rate),
                buffer_size: cpal::BufferSize::Default,
            };

            let out_rate = out_default_config.sample_rate().0;
            let out_channels = out_default_config.channels();
            let out_config = StreamConfig {
                channels: out_channels,
                sample_rate: cpal::SampleRate(out_rate),
                buffer_size: cpal::BufferSize::Default,
            };

            let input_stream = match in_default_config.sample_format() {
                SampleFormat::F32 => input_device.build_input_stream(
                    &in_config,
                    move |data: &[f32], _| {
                        let mulaw = resample_input_to_8k_mulaw(data, in_rate, in_channels);
                        if !mulaw.is_empty() {
                            let _ = mic_tx.send(mulaw);
                        }
                    },
                    |err| eprintln!("Input audio stream error: {err}"),
                    None,
                ),
                SampleFormat::I16 => input_device.build_input_stream(
                    &in_config,
                    move |data: &[i16], _| {
                        let f32_samples: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 32768.0).collect();
                        let mulaw = resample_input_to_8k_mulaw(&f32_samples, in_rate, in_channels);
                        if !mulaw.is_empty() {
                            let _ = mic_tx.send(mulaw);
                        }
                    },
                    |err| eprintln!("Input audio stream error: {err}"),
                    None,
                ),
                sample_format => {
                    let _ = ready_tx.send(Err(format!(
                        "Unsupported input sample format: {sample_format:?}"
                    )));
                    return;
                }
            };

            let input_stream = match input_stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to build input stream: {e}")));
                    return;
                }
            };

            let output_stream = match out_default_config.sample_format() {
                SampleFormat::F32 => {
                    let queue = Arc::clone(&queue_clone);
                    let marks = Arc::clone(&marks_clone);
                    let mark_tx = mark_tx.clone();
                    output_device.build_output_stream(
                        &out_config,
                        move |data: &mut [f32], _| {
                            drain_output_f32(data, &queue, &marks, &mark_tx);
                        },
                        |err| eprintln!("Output audio stream error: {err}"),
                        None,
                    )
                }
                SampleFormat::I16 => {
                    let queue = Arc::clone(&queue_clone);
                    let marks = Arc::clone(&marks_clone);
                    let mark_tx = mark_tx.clone();
                    output_device.build_output_stream(
                        &out_config,
                        move |data: &mut [i16], _| {
                            drain_output_i16(data, &queue, &marks, &mark_tx);
                        },
                        |err| eprintln!("Output audio stream error: {err}"),
                        None,
                    )
                }
                sample_format => {
                    let _ = ready_tx.send(Err(format!(
                        "Unsupported output sample format: {sample_format:?}"
                    )));
                    return;
                }
            };

            let output_stream = match output_stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to build output stream: {e}")));
                    return;
                }
            };

            if let Err(e) = input_stream.play() {
                let _ = ready_tx.send(Err(format!("Failed to play input stream: {e}")));
                return;
            }
            if let Err(e) = output_stream.play() {
                let _ = ready_tx.send(Err(format!("Failed to play output stream: {e}")));
                return;
            }

            let _ = ready_tx.send(Ok((out_rate, out_channels)));

            let _streams = (input_stream, output_stream);
            let _ = thread_stop_rx.blocking_recv();
        });

        let (out_rate, out_channels) = ready_rx
            .recv()
            .map_err(|e| format!("Audio engine initialization channel closed: {e}"))??;

        Ok(Self {
            output_queue,
            pending_marks,
            playback_epoch,
            stop_tx: Mutex::new(Some(thread_stop_tx)),
            out_rate,
            out_channels,
        })
    }

    pub fn enqueue_audio(&self, mulaw_bytes: &[u8]) {
        let epoch = self.playback_epoch.load(Ordering::SeqCst);
        let samples = resample_8k_mulaw_to_output(mulaw_bytes, self.out_rate, self.out_channels);
        if samples.is_empty() {
            return;
        }
        let mut queue = self.output_queue.lock().unwrap();
        if self.playback_epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        queue.extend(samples);
    }

    pub fn enqueue_mark(&self, name: String) {
        let epoch = self.playback_epoch.load(Ordering::SeqCst);
        let queue = self.output_queue.lock().unwrap();
        if self.playback_epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        let remaining_samples = queue.len();
        drop(queue);
        let mut marks = self.pending_marks.lock().unwrap();
        if self.playback_epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        marks.push_back((remaining_samples, name));
    }

    pub fn clear_playback(&self) {
        self.playback_epoch.fetch_add(1, Ordering::SeqCst);
        let mut queue = self.output_queue.lock().unwrap();
        queue.clear();
        drop(queue);
        let mut marks = self.pending_marks.lock().unwrap();
        marks.clear();
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        if let Ok(mut lock) = self.stop_tx.lock() {
            if let Some(tx) = lock.take() {
                let _ = tx.send(());
            }
        }
    }
}

fn advance_marks(
    samples_played: usize,
    marks: &Mutex<VecDeque<(usize, String)>>,
    mark_tx: &mpsc::UnboundedSender<String>,
) {
    if samples_played == 0 {
        return;
    }
    let mut marks = marks.lock().unwrap();
    if marks.is_empty() {
        return;
    }
    let mut ready_marks = Vec::new();
    for (remaining, name) in marks.iter_mut() {
        if *remaining <= samples_played {
            *remaining = 0;
            ready_marks.push(name.clone());
        } else {
            *remaining -= samples_played;
        }
    }
    marks.retain(|(remaining, _)| *remaining > 0);
    for name in ready_marks {
        let _ = mark_tx.send(name);
    }
}

fn drain_output_f32(
    data: &mut [f32],
    queue: &Mutex<VecDeque<f32>>,
    marks: &Mutex<VecDeque<(usize, String)>>,
    mark_tx: &mpsc::UnboundedSender<String>,
) {
    let mut queue = queue.lock().unwrap();
    let mut samples_played = 0;
    for sample in data.iter_mut() {
        if let Some(val) = queue.pop_front() {
            *sample = val;
            samples_played += 1;
        } else {
            *sample = 0.0;
        }
    }
    drop(queue);
    advance_marks(samples_played, marks, mark_tx);
}

fn drain_output_i16(
    data: &mut [i16],
    queue: &Mutex<VecDeque<f32>>,
    marks: &Mutex<VecDeque<(usize, String)>>,
    mark_tx: &mpsc::UnboundedSender<String>,
) {
    let mut queue = queue.lock().unwrap();
    let mut samples_played = 0;
    for sample in data.iter_mut() {
        if let Some(val) = queue.pop_front() {
            let clamped = val.clamp(-1.0, 1.0);
            *sample = (clamped * 32767.0) as i16;
            samples_played += 1;
        } else {
            *sample = 0;
        }
    }
    drop(queue);
    advance_marks(samples_played, marks, mark_tx);
}
