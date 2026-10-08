# Google sign-in and local sharing

StoryTool uses Google to verify an account and keeps a separate story library for
each account. The existing stories are claimed automatically when
`ankeshkmr2010@gmail.com` first signs in, provided that address is set as
`STORYTOOL_LEGACY_OWNER_EMAIL` in `api/.env`.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create or select a project and configure its OAuth consent screen. Choose
   **External** unless all users belong to one Google Workspace organization.
   If the app is in testing, add each intended Google address as a test user.
2. Create an OAuth client ID of type **Web application**. Add these **Authorized
   JavaScript origins**: `http://localhost:5173`, `http://localhost:5174`, and
   your ngrok HTTPS origin (for example,
   `https://unstiff-stanchable-christian.ngrok-free.dev`). Use the exact URL ngrok
   assigns if it changes. The Google Identity Services button uses a JavaScript
   callback, so this setup does not require a redirect URI.
3. Copy the **client ID** into `api/.env`:

   ```dotenv
   STORYTOOL_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   STORYTOOL_LEGACY_OWNER_EMAIL=ankeshkmr2010@gmail.com
   ```

   Restart the API on port 8000 so it reads the new setting. The client secret
   is not used by this sign-in flow.
4. Keep the API on port 8000 and the normal frontend on port 5173 running. To
   share the site from PowerShell in the repository root, run:

   ```powershell
   .\scripts\share-local.ps1
   ```

The script checks that the API requires sign-in, starts a second frontend on
`127.0.0.1:5174`, and shares it through ngrok. Your original local frontend
stays on port 5173. Each Google account can create and see only its own stories.
The ngrok free tier may show a browser warning before the app sign-in page.

To close the public URL:

```powershell
.\scripts\stop-share.ps1
```
