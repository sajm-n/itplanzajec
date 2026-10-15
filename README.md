# sajm-m.github.io
Aplikacja do planu zajęć na kierunu Informatyka Techniczna na Politechnice Lubelskiej

## Powiadomienia przy zamkniętej aplikacji

Aplikacja jest statyczna (GitHub Pages), więc powiadomienia przy zamkniętej aplikacji wysyła workflow
`.github/workflows/notify.yml` (co ok. 5 minut, Web Push). Jednorazowa konfiguracja:

1. W repozytorium: **Settings → Secrets and variables → Actions → New repository secret**, nazwa `VAPID_PRIVATE_KEY`
   (wartość to klucz prywatny pasujący do `VAPID_PUBLIC` w `index.html`).
2. W aplikacji (z tokenem GitHub w Ustawieniach) włącz powiadomienia — urządzenie zapisze się w `push-subscriptions.json`.
   Na iPhonie aplikacja musi być dodana do ekranu głównego (iOS 16.4+).
3. Test: **Actions → Powiadomienia o zadaniach → Run workflow** z zaznaczonym „test”.

