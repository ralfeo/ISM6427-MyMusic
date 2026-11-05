# MyMusic: AI song studio

Users describe a song, or write their own lyrics, and get two original AI-generated tracks they can stream and download. The tracks come from the [Suno API](https://docs.sunoapi.org/).

## How it works

```
Browser (public/)  ──►  Netlify Functions (/api/*)  ──►  api.sunoapi.org
  HTML/CSS/JS            keeps SUNO_API_KEY secret         generates music
```

- **Simple mode**: you describe the song and Suno writes the lyrics (`customMode: false`).
- **Custom mode**: you set the title, style and exact lyrics. **✨ Write with AI** drafts lyrics for you. Advanced options: vocal gender, length (10–360 s), styles to avoid, style adherence, weirdness.
- Models: `V6` (default), `V6_WILD`, `V6_MINI`.
- The app polls `GET /api/v1/generate/record-info` until the tracks are ready. A streaming preview usually shows up first and the final MP3 follows.
- Your track list is saved in the browser (localStorage). Suno keeps the files for about 14 days, so download any you want to keep.

| Route | Suno endpoint |
|---|---|
| `POST /api/generate` | `POST /api/v1/generate` |
| `GET /api/status?taskId=…` | `GET /api/v1/generate/record-info` |
| `GET /api/status?type=lyrics&taskId=…` | `GET /api/v1/lyrics/record-info` |
| `POST /api/lyrics` | `POST /api/v1/lyrics` |
| `GET /api/credits` | `GET /api/v1/generate/credit` |
| `POST /api/callback` | no-op receiver for the `callBackUrl` that Suno requires |

## Deploy on Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this repo. `netlify.toml` already sets the build options (publish `public`, functions `netlify/functions`, no build command).
2. Go to **Site configuration → Environment variables** and add:
   - `SUNO_API_KEY`: your key from https://sunoapi.org/api-key (**required**)
   - `APP_PASSWORD`: optional. When it's set, users must enter this password before they can generate, so strangers can't spend your credits.
   - `SUNO_API_BASE`: optional. Defaults to `https://api.sunoapi.org`.
3. Trigger a redeploy so the functions pick up the variables.

> Never put the API key in the front-end code or commit it to git.

## Local development

```bash
npm i -g netlify-cli
echo "SUNO_API_KEY=your_key_here" > .env
netlify dev
```
