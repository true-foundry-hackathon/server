pub fn linear_to_mulaw(pcm_val: i16) -> u8 {
    const BIAS: i16 = 0x84;
    const CLIP: i16 = 32635;

    let (sign, mut sample) = if pcm_val < 0 {
        (0x80, (-pcm_val).min(CLIP))
    } else {
        (0x00, pcm_val.min(CLIP))
    };

    sample += BIAS;
    let mut exponent = 7;
    let mut mask = 0x4000;
    while (sample & mask) == 0 && exponent > 0 {
        exponent -= 1;
        mask >>= 1;
    }
    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    let mulaw = (sign | (exponent << 4) | mantissa) as u8;
    !mulaw
}

pub fn mulaw_to_linear(u_val: u8) -> i16 {
    let u_val = !u_val;
    let sign = (u_val & 0x80) != 0;
    let exponent = (u_val >> 4) & 0x07;
    let mantissa = (u_val & 0x0F) as i16;
    let mut sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    if sign { -sample } else { sample }
}

pub fn resample_input_to_8k_mulaw(input: &[f32], in_rate: u32, in_channels: u16) -> Vec<u8> {
    if input.is_empty() || in_rate == 0 || in_channels == 0 {
        return Vec::new();
    }

    let ch = in_channels as usize;
    let mono_len = input.len() / ch;
    if mono_len == 0 {
        return Vec::new();
    }

    let mut mono = Vec::with_capacity(mono_len);
    for frame in input.chunks_exact(ch) {
        let sum: f32 = frame.iter().sum();
        mono.push(sum / ch as f32);
    }

    if in_rate == 8000 {
        return mono
            .iter()
            .map(|&s| {
                let clamped = s.clamp(-1.0, 1.0);
                let pcm = (clamped * 32767.0) as i16;
                linear_to_mulaw(pcm)
            })
            .collect();
    }

    let target_len = (mono.len() as f64 * 8000.0 / in_rate as f64).round() as usize;
    let mut output = Vec::with_capacity(target_len);

    for i in 0..target_len {
        let src_idx = (i as f64 * in_rate as f64) / 8000.0;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(mono.len() - 1);
        let frac = (src_idx - idx0 as f64) as f32;

        let s0 = mono.get(idx0).copied().unwrap_or(0.0);
        let s1 = mono.get(idx1).copied().unwrap_or(0.0);
        let sample = s0 + frac * (s1 - s0);

        let clamped = sample.clamp(-1.0, 1.0);
        let pcm = (clamped * 32767.0) as i16;
        output.push(linear_to_mulaw(pcm));
    }

    output
}

pub fn resample_8k_mulaw_to_output(mulaw: &[u8], out_rate: u32, out_channels: u16) -> Vec<f32> {
    if mulaw.is_empty() || out_rate == 0 || out_channels == 0 {
        return Vec::new();
    }

    let pcm_samples: Vec<f32> = mulaw
        .iter()
        .map(|&b| mulaw_to_linear(b) as f32 / 32768.0)
        .collect();

    let target_len = (pcm_samples.len() as f64 * out_rate as f64 / 8000.0).round() as usize;
    let ch = out_channels as usize;
    let mut out = Vec::with_capacity(target_len * ch);

    for i in 0..target_len {
        let src_idx = (i as f64 * 8000.0) / out_rate as f64;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(pcm_samples.len() - 1);
        let frac = (src_idx - idx0 as f64) as f32;

        let s0 = pcm_samples.get(idx0).copied().unwrap_or(0.0);
        let s1 = pcm_samples.get(idx1).copied().unwrap_or(0.0);
        let sample = s0 + frac * (s1 - s0);

        for _ in 0..ch {
            out.push(sample);
        }
    }

    out
}
