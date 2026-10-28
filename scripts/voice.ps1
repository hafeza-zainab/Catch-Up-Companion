$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$demoFile = Join-Path $repoRoot "DEMO.md"
$outputDirectory = Join-Path $repoRoot "demo"
$outputFile = Join-Path $outputDirectory "voiceover.wav"

if (-not (Test-Path -LiteralPath $demoFile -PathType Leaf)) {
  throw "DEMO.md was not found at $demoFile"
}

$voiceoverLines = @()
foreach ($line in Get-Content -LiteralPath $demoFile -Encoding UTF8) {
  $match = [regex]::Match($line, '^\|\s*\*\*[^|]+\*\*\s*\|\s*[^|]*\|\s*(.+?)\s*\|$')
  if (-not $match.Success) { continue }

  $spokenLine = $match.Groups[1].Value.Trim()
  $spokenLine = $spokenLine -replace '^[“"]|[”"]$', ''
  $spokenLine = $spokenLine -replace '`', ''
  if ($spokenLine) { $voiceoverLines += $spokenLine }
}

if ($voiceoverLines.Count -eq 0) {
  throw "No voiceover lines were found in the DEMO.md timing table."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Add-Type -AssemblyName System.Speech
$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$audioFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

try {
  $synthesizer.SetOutputToWaveFile($outputFile, $audioFormat)
  foreach ($spokenLine in $voiceoverLines) {
    $synthesizer.Speak($spokenLine)
  }
} finally {
  $synthesizer.Dispose()
}

Write-Output "Generated $outputFile from $($voiceoverLines.Count) DEMO.md voiceover lines."
