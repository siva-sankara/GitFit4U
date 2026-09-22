# Notification sound

`notification.mp3` is an original, synthesized two-note chime created for GETFIT4U (0.8 seconds, mono, 44.1 kHz, 96 kbps MP3). It contains no third-party samples and needs no external audio service or runtime encoder.

The browser serves this file at `/sounds/notification.mp3`. Keep it with the frontend public assets when deploying. Users can mute it or play a preview in Notifications. Browsers can block unsolicited audio until the user interacts with the page. Background push uses the browser/operating system's notification sound; service workers cannot play this custom MP3.
