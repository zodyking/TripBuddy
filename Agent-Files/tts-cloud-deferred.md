# Cloud TTS (deferred)

If browser `speechSynthesis` is not enough (identical voice everywhere, missing API on a target browser, or higher quality), add an optional server route such as `GET /api/tts?text=…` backed by an official provider (Google Cloud Text-to-Speech, Azure Speech, AWS Polly) or self-hosted TTS. The client would fetch audio and play it with `<audio>` or `AudioContext` — playback still happens **on the user’s device**, not on the server speakers.

Do not rely on unofficial Google Translate speech endpoints; they are unstable and typically disallowed for apps.
