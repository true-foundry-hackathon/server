/**
* Local PTY-backed shell session driven by commands received over the
* device's real-time connection to Vox Core.
*/
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ponytail: output capture uses a fixed idle-quiet heuristic rather than
// tracking real shell prompts, so a long-running command (e.g. `tail -f`)
// will just time out at MAX_WAIT with partial output. Good enough for
// one-shot commands like the ones a voice call asks for.
const IDLE_QUIET: Duration = Duration::from_millis(500);
const MAX_WAIT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

struct PtySession {
    writer: Box<dyn Write + Send>,
    output: Arc<Mutex<Vec<u8>>>,
    _master: Box<dyn MasterPty + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct TerminalManager(Arc<Mutex<Option<PtySession>>>);

impl TerminalManager {
    /// Opens a shell session if one isn't already running. Idempotent.
    pub fn open_shell(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        if let Ok(home) = std::env::var("HOME") {
            cmd.cwd(home);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let output = Arc::new(Mutex::new(Vec::new()));
        let output_writer = output.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut buf) = output_writer.lock() {
                            buf.extend_from_slice(&chunk[..n]);
                        }
                    }
                }
            }
        });

        *guard = Some(PtySession {
            writer,
            output,
            _master: pair.master,
            _child: child,
        });
        Ok(())
    }

    /// Writes `command` to the open session and waits for its output to go
    /// quiet, returning what was captured. Blocking: call from a dedicated
    /// thread (e.g. `spawn_blocking`), never from an async task directly.
    pub fn run_command(&self, command: &str) -> Result<String, String> {
        let output = {
            let mut guard = self.0.lock().map_err(|e| e.to_string())?;
            if guard.is_none() {
                drop(guard);
                self.open_shell()?;
                guard = self.0.lock().map_err(|e| e.to_string())?;
            }
            let session = guard.as_mut().ok_or("no terminal session is open")?;
            if let Ok(mut buf) = session.output.lock() {
                buf.clear();
            }
            session
                .writer
                .write_all(command.as_bytes())
                .map_err(|e| e.to_string())?;
            session.writer.write_all(b"\n").map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
            session.output.clone()
        };

        let start = Instant::now();
        let mut last_len = 0usize;
        let mut last_change = Instant::now();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let len = output.lock().map(|buf| buf.len()).unwrap_or(0);
            if len != last_len {
                last_len = len;
                last_change = Instant::now();
            }
            if len > 0 && last_change.elapsed() >= IDLE_QUIET {
                break;
            }
            if start.elapsed() >= MAX_WAIT {
                break;
            }
        }

        let bytes = output.lock().map(|buf| buf.clone()).unwrap_or_default();
        Ok(strip_ansi(&String::from_utf8_lossy(&bytes)))
    }
}

/// Strips common ANSI escape sequences so command output reads cleanly as
/// plain text (it gets spoken back and/or sent to an LLM, not rendered).
fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for next in chars.by_ref() {
                        if next.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        output.push(c);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{strip_ansi, TerminalManager};

    #[test]
    fn strips_color_codes_and_keeps_text() {
        let input = "\u{1b}[32mok\u{1b}[0m: \u{1b}[1mdone\u{1b}[0m\n";
        assert_eq!(strip_ansi(input), "ok: done\n");
    }

    #[test]
    fn open_shell_then_run_command_round_trips_real_output() {
        let manager = TerminalManager::default();
        manager.open_shell().expect("open shell");
        let output = manager
            .run_command("echo vox-terminal-check")
            .expect("run command");
        assert!(
            output.contains("vox-terminal-check"),
            "expected echoed marker in output, got: {output:?}"
        );

        // The PTY session persists state across commands, like a real shell.
        manager.run_command("cd /tmp").expect("cd");
        let pwd = manager.run_command("pwd").expect("pwd");
        assert!(
            pwd.contains("/tmp"),
            "expected /tmp in pwd output, got: {pwd:?}"
        );
    }
}
