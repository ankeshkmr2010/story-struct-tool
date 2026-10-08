# Deploy StoryTool to Render + Neon

This deploys the built React frontend and Litestar API at one HTTPS URL, with
PostgreSQL on Neon. Your laptop and ngrok are no longer needed for the hosted app.
The local application is unchanged. Use this free deployment for a small beta;
Render can sleep after 15 minutes idle and take roughly a minute to wake.

## 1. Put the deployment changes on GitHub

The existing remote is https://github.com/ankeshkmr2010/story-struct-tool.
Render builds from GitHub, so local changes must be committed and pushed first.
Review the changes with GitHub Desktop or your usual Git workflow.

Include `Dockerfile`, `.dockerignore`, `.gitattributes`, `render.yaml`, the scripts,
and the application changes. Do not include `.env`, local logs, local MCP
credentials, database dumps, or API keys. The repository ignores local secrets;
the Docker build context additionally allows only required source/build files.

## 2. Create a Neon database

1. Sign in at https://console.neon.tech/ and create a project named `storytool`.
2. Choose a region also available in Render, preferably nearby. Singapore is a
   useful choice for India if both accounts offer it; otherwise choose a common region.
3. Open **Connect** on the default branch. Select the provided database and role.
4. Turn **connection pooling off** for this first, single-instance deployment.
   Use the direct connection for both application traffic and startup migrations.
5. Copy the PostgreSQL connection string. It contains a password: paste it only
   into Render's environment-variable form, not GitHub or chat.

You may keep the `postgresql://` prefix, `sslmode=require`, and
`channel_binding=require` from Neon. The app selects asyncpg automatically,
translates SSL to certificate-verified TLS, and removes the libpq-specific
channel-binding argument. No manual URL editing is needed.

This guide starts with a new hosted database. Existing local stories are not
automatically copied. New Google accounts receive private starter examples.

## 3. Create the Render service

1. Sign in at https://dashboard.render.com/ and connect your GitHub account.
2. Choose **New → Web Service**, then select `story-struct-tool`.
3. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Name | `storytool` or another available name |
   | Branch | The branch containing the deployment changes |
   | Root directory | Leave blank |
   | Language/runtime | Docker |
   | Dockerfile path | `./Dockerfile` |
   | Docker build context | Repository root / `.` |
   | Docker command override | Leave blank |
   | Region | Same region as Neon when available |
   | Instance type | Free |
   | Health check path | `/api/health` |

The Dockerfile builds React with Node 24 and installs the locked Python 3.12
dependencies. Startup runs database migrations and then listens on Render's
assigned `PORT`. Do not configure the Vite development server on Render.

Frontend routes, API authentication, URL conversion, and configuration checks were
verified locally. The local Docker engine did not respond to the image-build check;
the container build still needs to complete on Render before this deployment is verified.

Alternatively, **New → Blueprint** can load `render.yaml`, which declares one
free web service and prompts for the three private settings below. It does not
create a Render database; use Neon for persistent story storage.

## 4. Add environment variables before deploying

| Name | Value |
| --- | --- |
| `STORYTOOL_DATABASE_URL` | The full direct Neon connection string |
| `STORYTOOL_GOOGLE_CLIENT_ID` | Your existing Google Web client ID |
| `STORYTOOL_AI_ENCRYPTION_KEY` | Your existing local encryption key |
| `STORYTOOL_DEBUG` | `false` |
| `STORYTOOL_DB_ECHO` | `false` |
| `STORYTOOL_NOTICING_BACKEND` | `deterministic` initially |

From PowerShell in `D:\learning\StoryTool`, copy the existing values privately:

```powershell
.\scripts\copy-deployment-setting.ps1 -Name GoogleClientId
```

Paste into Render's `STORYTOOL_GOOGLE_CLIENT_ID` field. Then run:

```powershell
.\scripts\copy-deployment-setting.ps1 -Name EncryptionKey
```

Paste into Render's `STORYTOOL_AI_ENCRYPTION_KEY` field. The helper copies the
values to your clipboard without displaying them. Keep this encryption key
stable across redeploys; changing it makes saved provider keys unreadable.

No global OpenRouter key is required. After signing in, each author can save
their own provider connection in the hosted app's Settings. `deterministic`
keeps the default scene reader local; saved per-user Jev/Claude reader connections
can still be used. The authoring assistant uses its selected per-user connection.

## 5. Deploy and enable Google login on the new URL

1. Click **Create Web Service / Deploy**. Watch the build and deploy logs.
2. Copy the service's actual URL, such as `https://storytool-xxxx.onrender.com`.
3. Open https://console.cloud.google.com/apis/credentials.
4. Edit the same OAuth **Web application** client already used locally.
5. Add the exact Render URL under **Authorized JavaScript origins**. Include
   `https://`, with no path or trailing slash. Keep your existing localhost and
   ngrok origins if you still use them. This login flow uses a JavaScript callback,
   so it does not need a new OAuth redirect URI.
6. Save and allow time for Google's setting to propagate. If the consent app is
   in testing, add the intended Google accounts as test users.

Google login can fail until this origin has been added, even if deployment is healthy.

## 6. Verify the hosted app

1. Open `<your-render-url>/api/health`: expect `{"status":"ok"}`.
2. Open `<your-render-url>/`: expect the StoryTool login page.
3. Sign in with Google. Open an example and edit one field; refresh to check it persisted.
4. Open a story URL directly and reload it. The production frontend supports deep links.
5. Open the timeline, toggle world time/reading order, and check scene navigation.
6. Save an OpenRouter connection in hosted Settings, test it, then send `hello`.
7. Request a small edit batch, inspect it, apply, and undo before making later changes.
8. Sign in as another account and verify its story library is separate.

Provider replies and diagnostics go to Render's application log stream; keys are
redacted. Local log files are not copied into the container and are not durable
storage on the free service.

## Existing local stories

Keep using the local application while checking the hosted version. Database
import is a separate step: back up the local PostgreSQL database and restore it
into an empty hosted database, then verify migrations. Preserve the original
encryption key if importing saved connections. Do not overwrite a hosted database
that already contains new work. Back up both sides before any import.

## Troubleshooting

- **Build cannot find files:** root directory must be blank; Docker context is the repo root.
- **Database authentication/SSL error:** re-copy the full direct Neon URL. Ensure its
  role/password/database match, and that the project is active.
- **Migration fails:** inspect deploy logs; the server intentionally does not start after
  a failed migration. Do not clear the database to work around it.
- **Google origin error:** add the actual Render HTTPS origin to the correct Google client.
- **403 on browser writes:** use the service's own URL for both frontend and API.
- **Saved provider key cannot be read:** restore the original encryption key or reconnect
  that provider in Settings.
- **Slow first page:** free Render services and Neon compute can sleep. Wait for them to wake.

References: [Render Docker](https://render.com/docs/docker),
[Render free limits](https://render.com/docs/free),
[Render Blueprint settings](https://render.com/docs/blueprint-spec),
[Neon connections](https://neon.com/docs/connect/connect-from-any-app).
