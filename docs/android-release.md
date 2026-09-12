# XFreedom Android release

## Что считается готовым релизом

Android field release считается собранным только если одновременно выполнено следующее:

- `:app:testDebugUnitTest` проходит;
- R8/ProGuard release build проходит;
- создан подписанный `app-release.apk`;
- создан подписанный `app-release.aab`;
- `apksigner verify` подтверждает APK;
- `jarsigner -verify` подтверждает AAB;
- для обоих файлов сохранены SHA-256.

Обычный `.github/workflows/android-ci.yml` использует одноразовый CI-ключ. Эти артефакты проверяют release pipeline, но не являются ключом обновлений production-приложения.

`.github/workflows/android-release.yml` использует постоянный upload key только из GitHub Actions Secrets и выдаёт field APK/AAB, пригодные для установки/загрузки при условии корректно настроенного ключа.

## GitHub Secrets для постоянного upload key

- `ANDROID_UPLOAD_KEYSTORE_BASE64` — полный keystore, закодированный base64;
- `ANDROID_UPLOAD_STORE_PASSWORD`;
- `ANDROID_UPLOAD_KEY_ALIAS`;
- `ANDROID_UPLOAD_KEY_PASSWORD`.

Ни keystore, ни пароли не должны попадать в git, issue, PR, build logs или обычные artifacts.

## Google Play

Для нового приложения используется Play App Signing:

1. Google Play хранит app signing key.
2. XFreedom хранит отдельный upload key.
3. В Play Console регистрируется сертификат upload key.
4. В CI AAB подписывается upload key перед загрузкой.

Для автоматической загрузки используется официальный Google Play Android Developer API. В GitHub Secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` хранится JSON service account, которому в Play Console выданы только необходимые права на XFreedom.

Когда `upload_to_play=true`, workflow:

1. создаёт Play edit;
2. загружает проверенный AAB;
3. назначает release выбранному track (по умолчанию `internal`);
4. commit'ит edit;
5. завершает job ошибкой, если любой реальный API-вызов не прошёл.

Первое создание приложения, проверка developer identity и предоставление service account доступа выполняются внутри Google Play Console и не могут быть достоверно имитированы кодом репозитория.

## Field acceptance перед публикацией

На физическом Android-устройстве нужно проверить:

1. установка `app-release.apk`;
2. системное разрешение VPN;
3. VLESS/REALITY TCP-трафик;
4. DNS через туннель;
5. UDP, если активный transport его поддерживает;
6. YouTube / Telegram / WhatsApp / Instagram / TikTok probes без логина и без сбора payload;
7. повторное подключение после смены Wi-Fi/LTE;
8. обновление поверх предыдущей версии тем же production key.

Факт успешной CI-сборки не считается доказательством доступности сервиса из конкретной российской сети.
