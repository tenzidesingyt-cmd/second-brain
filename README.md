# Второй мозг

Личный кабинет для мыслей, задач и медиа. Один вход с компьютера и телефона: инбокс, AI-разбор, заметки, задачи, привычки, календарь и аналитика.

## Возможности

- **Инбокс** — текст, фото, видео, голосовые и файлы. Материал сохраняется сразу, разбор ИИ запускается отдельно.
- **AI-разбор через OpenRouter** — распознаёт текст на фото, расшифровывает голос, раскладывает материал на заметку, задачи и события, подставляет сроки.
- **Заметки** — Markdown, вложения, теги, типы, полнотекстовый поиск и AI-поиск по смыслу.
- **Задачи и привычки** — приоритеты, сроки, отметки выполнения, серии.
- **Календарь** — события и задачи на месяц, быстрый переход к дню.
- **Аналитика** — недельная сводка и AI-итоги.
- **Realtime** — изменения мгновенно появляются на всех устройствах через WebSocket.
- **PWA** — установка на телефон и компьютер, офлайн-оболочка, быстрый захват с домашнего экрана.
- **Вход через Google** — OAuth 2.0, доступ только для Google-аккаунта владельца. Пароль можно оставить резервным способом.
- **Экспорт данных** — заметки, задачи, события и привычки одним JSON-файлом.

## Стек

React 19, TypeScript, Vite, TanStack Query, Express 5, SQLite (`node:sqlite`, FTS5), WebSocket (`ws`), OpenRouter, PWA.

## Быстрый старт

Нужен Node.js 24 или новее — приложение использует встроенный `node:sqlite`.

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Приложение откроется на `http://localhost:8787`.

Для разработки с горячей перезагрузкой:

```bash
npm run dev
```

Vite поднимется на `http://localhost:5173` и будет проксировать API на `http://localhost:8787`.

### Настройка ИИ

1. Получите ключ на [openrouter.ai/keys](https://openrouter.ai/keys).
2. Укажите `OPENROUTER_API_KEY` в `.env` или вставьте ключ на экране **Настройки**.
3. Проверьте связь кнопкой «Проверить подключение».

Ключ из `.env` имеет приоритет над ключом из настроек. Модели по умолчанию: `google/gemini-2.5-flash` для текста и фото, `openai/whisper-1` для голоса. Их можно заменить в настройках.

### Вход через Google

Приложение пускает только один Google-аккаунт — владельца кабинета. Остальные аккаунты получают отказ.

1. Откройте [Google Cloud Console](https://console.cloud.google.com/) и создайте проект.
2. В **APIs & Services → OAuth consent screen** выберите **External**, заполните название и email поддержки. В **Test users** добавьте свой Gmail.
3. В **Credentials → Create credentials → OAuth client ID** выберите **Web application**.
4. Добавьте адреса:
   - **Authorized JavaScript origins:** `https://<домен>`
   - **Authorized redirect URIs:** `https://<домен>/api/auth/google/callback`
   - Для локальной проверки: `http://localhost:8787` и `http://localhost:8787/api/auth/google/callback`.
5. Скопируйте **Client ID** и **Client secret**.
6. Задайте переменные окружения:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://<домен>/api/auth/google/callback
OWNER_EMAIL=your@gmail.com
```

7. Перезапустите приложение.

Пока приложение в режиме **Testing**, войти смогут только добавленные Test users. Для личного использования этого достаточно; чтобы пускать любой аккаунт владельца без ограничений, опубликуйте приложение (Publish app). Запрашиваемые scopes — только `openid`, `email`, `profile`, они не требуют дополнительной проверки Google.

Если `APP_PASSWORD` оставить заполненным, на экране входа появится резервный вход по паролю. Если очистить — останется только Google.

### Доступ с телефона в домашней сети

1. Запустите сервер на компьютере.
2. Откройте на телефоне `http://<IP-компьютера>:8787` (IP печатается при старте сервера).
3. Установите приложение: в Chrome — «Установить приложение», в Safari — «Поделиться» → «На экран Домой».

Микрофон и установка PWA в интернете требуют HTTPS.

## Публикация в интернет

### Важно про GitHub Pages

GitHub Pages отдаёт только статические файлы. Этому приложению нужен Node-сервер, SQLite, загрузка файлов, WebSocket и прокси к OpenRouter, поэтому **GitHub Pages его не запустит**. Ссылка на репозиторий GitHub — это исходный код, а не работающий сайт.

Рабочая схема: репозиторий на GitHub + хостинг с Node и постоянным диском, подключённый к этому репозиторию. Ниже — готовые варианты.

### Вариант 1. Railway

Railway — основной вариант: контейнер работает постоянно, диск сохраняет SQLite и загрузки. После пробного периода тариф Hobby стоит около $5 в месяц.

1. Создайте проект **Deploy from GitHub repo** и выберите репозиторий.
2. Добавьте **Volume** и смонтируйте его в `/app/data`.
3. Задайте переменные:
   - `DATA_DIR=/app/data`
   - `APP_PASSWORD` — резервный пароль
   - `OPENROUTER_API_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OWNER_EMAIL` — после настройки Google OAuth
4. Сгенерируйте домен в **Settings → Networking → Generate Domain**.
5. Проверьте `https://<домен>/api/health`.

Dockerfile собирается автоматически. Не запускайте несколько реплик: SQLite рассчитан на один экземпляр.

### Вариант 2. Render

В репозитории есть `render.yaml` и `Dockerfile`.

1. Загрузите проект в GitHub (см. раздел «GitHub» ниже).
2. В Render выберите **New → Blueprint** и подключите репозиторий.
3. Задайте переменные окружения.
4. Примените Blueprint.

Для SQLite и загрузок нужен постоянный диск, поэтому в `render.yaml` выбран платный план `starter` с диском 1 ГБ. На бесплатном плане диск недоступен: база и файлы будут пропадать при перезапуске.

### Вариант 3. Свой VPS

```bash
docker build -t second-brain .
docker run -d --name second-brain --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v second-brain-data:/app/data \
  --env-file .env \
  second-brain
```

Поставьте перед контейнером Caddy или Nginx с HTTPS. Пример для Caddy:

```caddyfile
brain.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy сам получит сертификат и пробросит WebSocket. Порт наружу открывать не нужно.

### Временная ссылка без хостинга

Если нужно открыть приложение с телефона прямо сейчас, подойдёт туннель Cloudflare. Обязательно задайте `APP_PASSWORD`.

```bash
cloudflared tunnel --url http://localhost:8787
```

Команда выдаст HTTPS-ссылку вида `https://....trycloudflare.com`. Она работает, пока включены компьютер, сервер и туннель. После перезапуска адрес меняется. Для постоянного сайта используйте Render, Railway или VPS.

## GitHub

```bash
git init
git add .
git commit -m "Второй мозг: личный кабинет с AI-инбоксом"
git branch -M main
git remote add origin https://github.com/<ваш-логин>/second-brain.git
git push -u origin main
```

Перед первым коммитом проверьте `git status`: в репозиторий не должны попасть `.env`, `data/`, `node_modules/` и `dist/`. Они уже перечислены в `.gitignore`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `8787` | Порт HTTP-сервера |
| `APP_PASSWORD` | пусто | Резервный пароль; пусто — вход только через Google |
| `GOOGLE_CLIENT_ID` | пусто | Client ID из Google Cloud |
| `GOOGLE_CLIENT_SECRET` | пусто | Client secret из Google Cloud |
| `GOOGLE_REDIRECT_URI` | авто | Точный callback URL Google OAuth |
| `OWNER_EMAIL` | пусто | Gmail владельца; другие аккаунты не допускаются |
| `OPENROUTER_API_KEY` | пусто | Ключ OpenRouter |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | Текстовая модель |
| `OPENROUTER_VISION_MODEL` | `google/gemini-2.5-flash` | Модель для изображений |
| `OPENROUTER_STT_MODEL` | `openai/whisper-1` | Модель расшифровки аудио |
| `DATA_DIR` | `./data` | Каталог базы и загрузок |
| `PUBLIC_URL` | `http://localhost:8787` | Публичный адрес для заголовка OpenRouter |

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm run dev` | Сервер и Vite одновременно |
| `npm run dev:server` | Только API с автоперезагрузкой |
| `npm run dev:web` | Только фронтенд |
| `npm run build` | Проверка типов и production-сборка |
| `npm start` | Production-сервер |
| `npm run typecheck` | Проверка TypeScript |
| `npm run preview` | Предпросмотр собранного фронтенда |

## Структура

```text
server/    Express API, SQLite, загрузки, AI, WebSocket
src/       React-приложение, страницы, компоненты, стили
shared/    Общие типы клиента и сервера
public/    PWA-манифест, иконки, service worker
scripts/   Генератор иконок
data/      База и вложения (не хранится в git)
```

## Безопасность и резервные копии

- Для публичного доступа настройте вход через Google или задайте `APP_PASSWORD`.
- Никогда не коммитьте `.env` и `data/`: там ключи, личные записи и вложения. На хостинге храните секреты только в переменных окружения.
- Ключи, попавшие в переписку или лог, лучше перевыпустить.
- Резервная копия — это `data/brain.db` и каталог `data/uploads/`. Копируйте их при остановленном сервере или через `sqlite3 .backup`.
