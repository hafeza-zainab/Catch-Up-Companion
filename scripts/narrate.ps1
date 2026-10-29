Add-Type -AssemblyName System.Speech
$ErrorActionPreference = "Stop"
Set-Location "C:\dev\Catch-Up Companion"
function Dur($f) { [double]((& ffprobe -v error -show_entries format=duration -of csv=p=0 $f) | Select-Object -First 1) }
$live = Dur "demo\live.mp4"; $codex = Dur "demo\codex.mp4"; $final = Dur "demo\final.mp4"
$expected = 38 + $live + $codex
"final=$final expected=$expected"
if ([math]::Abs($final - $expected) -gt 2) { Write-Warning "Scene lengths differ from the assumed timeline; narration may drift." }

$lines = @(
 @{ s = 0.3;  text = "Catch-Up Companion." },
 @{ s = 4.5;  text = "New viewers join mid-stream and feel lost. Catch-Up Companion tells them what they missed." },
 @{ s = 12.5; text = "Here it is on a real Twitch channel. A viewer types exclamation catch up. The bot replies in chat, and an overlay card appears on stream." },
 @{ s = 12 + $live + 0.5; text = "The recap shows top chatters, running jokes, and chat spikes. This demo uses sample chat." },
 @{ s = 20 + $live + 0.5; text = "It listens to Twitch event sub, stores events in SQLite, and builds the recap. Gemini polish is optional, with a plain template fallback." },
 @{ s = 32 + $live + 1;   text = "I built the whole project with OpenAI Codex, one prompt at a time: the Twitch listener, storage, recap engine, chat command, overlay, and replay mode." },
 @{ s = 32 + $live + 35;  text = "Codex also ran the builds and tests, fixed its own bugs, and committed every step to GitHub." },
 @{ s = 32 + $live + $codex + 0.5; text = "Catch-Up Companion. Built with Codex. Code on GitHub." }
)

$ff = @("-y", "-i", "demo\final.mp4")
$filters = @(); $labels = ""
for ($i = 0; $i -lt $lines.Count; $i++) {
  $wav = "demo\nar$i.wav"
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SetOutputToWaveFile((Join-Path (Get-Location) $wav))
  $synth.Speak($lines[$i].text)
  $synth.Dispose()
  $ff += @("-i", $wav)
  $ms = [int]($lines[$i].s * 1000)
  $filters += "[$($i + 1):a]adelay=${ms}:all=1[a$i]"
  $labels += "[a$i]"
}
$filters += "${labels}amix=inputs=$($lines.Count):normalize=0:duration=longest[aout]"
$ff += @("-filter_complex", ($filters -join ";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "demo\final_voice.mp4")
& ffmpeg @ff