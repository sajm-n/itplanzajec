# sajm-m.github.io
Aplikacja do planu zajęć na kierunu Informatyka Techniczna na Politechnice Lubelskiej

## Plan, komputer i iPad

Plan zajęć to zawsze siatka tygodnia (sobota i niedziela pojawiają się tylko, gdy mają zajęcia), z linią bieżącej godziny. Przesunięcie palcem w bok albo ←/→ zmienia tydzień.

Na szerokim ekranie (od 744 px szerokości i 600 px wysokości: komputer, iPad mini, 10.2", Air, 11" i 12.9" Pro, w pionie i w poziomie) aplikacja ma układ z panelem bocznym; telefon zostaje z dolnym paskiem:

- boczne menu zamiast dolnego paska, a pod zakładkami mini-kalendarz miesiąca: kliknięcie dnia pokazuje jego tydzień (także z zakładek Zadania i Przedmioty), podświetlony jest wybrany tydzień z literą A/B, a kropki oznaczają dni z nieukończonymi zadaniami (czerwona kropka: po terminie),
- okna zajęć, zadań i ustawień wysuwają się jako panel z prawej strony,
- skróty klawiszowe: ←/→ poprzedni/następny tydzień, T dziś, 1–3 zakładki, N nowe zadanie online,
- instalacja jako aplikacja (PWA) z ikon 192/512 px.

## Termin powiadomień

Każde zadanie może mieć własny termin powiadomienia (formularz zadania, pole „Powiadomienie”):

- **Domyślne**: reguła z Ustawień → „Domyślne powiadomienia” (start: zadania stacjonarne dzień przed zajęciami o 18:00, online 24 godziny przed terminem),
- **Przed terminem**: 5, 10, 15, 30 min, 1, 2 lub 5 godz. przed terminem zadania,
- **Data i godzina**: konkretny moment (musi być przed terminem zadania).

Pod polem widać na żywo, kiedy dokładnie przyjdzie powiadomienie. Własny termin zapisuje się w zadaniu (`rem`), a domyślne reguły w planie (`notif`) w `plan.json`;
te same dane czyta skrypt wysyłający powiadomienia, więc aplikacja i GitHub zawsze liczą ten sam moment. Zadanie, któremu przesunięto termin powiadomienia
na później niż poprzednie wysłanie, dostaje powiadomienie ponownie.

## Powiadomienia przy zamkniętej aplikacji

Aplikacja jest statyczna (GitHub Pages), więc powiadomienia przy zamkniętej aplikacji wysyła workflow
`.github/workflows/notify.yml` (pętla ok. 6 h sprawdzająca co minutę, Web Push; uruchamia ją co godzinę harmonogram GitHuba). Jednorazowa konfiguracja:

1. W repozytorium: **Settings → Secrets and variables → Actions → New repository secret**, nazwa `VAPID_PRIVATE_KEY`
   (wartość to klucz prywatny pasujący do `VAPID_PUBLIC` w `index.html`).
2. W aplikacji (z tokenem GitHub w Ustawieniach) włącz powiadomienia — urządzenie zapisze się w `push-subscriptions.json`.
   Na iPhonie aplikacja musi być dodana do ekranu głównego (iOS 16.4+).
3. Test: **Actions → Powiadomienia o zadaniach → Run workflow** z zaznaczonym „test”.

