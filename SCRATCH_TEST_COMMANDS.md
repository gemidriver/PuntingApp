# Scratch test commands

Open this file in VS Code and copy the commands to run them in your browser DevTools or terminal.

---

## 1) Extract Supabase access token from browser DevTools Console
Paste this into the Console while signed into the app (recommended):

```js
const keys = Object.keys(localStorage).filter(k=>k.toLowerCase().includes('supabase')||k.toLowerCase().includes('sb')||k.toLowerCase().includes('auth'));
console.log('candidate keys:', keys);
for (const k of keys) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    const token = v?.currentSession?.access_token || v?.access_token;
    if (token) { console.log('ACCESS_TOKEN:', token); break; }
  } catch(e){}
}
```

Copy the printed `ACCESS_TOKEN` value.

---

## 2) Alternative: request token via password grant
Replace `<YOUR_PROJECT>` and `<ANON_KEY>` and use admin credentials:

```bash
curl -X POST "https://<YOUR_PROJECT>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ADMIN_PASSWORD"}'
```

The response includes an `access_token` to use.

---

## 3) Simulated scratch (run in Terminal)
Replace `<ACCESS_TOKEN>` with the token you obtained. This triggers a simulated REMOVED runner for market `1.256220819` and notifies only the given user ID.

Bash:

```bash
curl -X POST "http://localhost:3000/api/market-runners/notify-scratches?marketId=1.256220819" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "simulate":[{"id":"78432776","name":"5. Reason To Shine","status":"REMOVED"}],
    "targetUserIds":["d0117fe5-616a-47f4-b9c0-ea8d0036c4a3"]
  }'
```

PowerShell:

```powershell
$body = '{
  "simulate":[{"id":"78432776","name":"5. Reason To Shine","status":"REMOVED"}],
  "targetUserIds":["d0117fe5-616a-47f4-b9c0-ea8d0036c4a3"]
}'

curl -X POST "http://localhost:3000/api/market-runners/notify-scratches?marketId=1.256220819" `
  -H "Authorization: Bearer <ACCESS_TOKEN>" `
  -H "Content-Type: application/json" `
  -d $body
```

---

## Security note
- Do NOT paste the access token in public chat. If you want me to run the POST for you, paste it here privately and I will execute it.
- Ensure the admin user has `is_admin = true` in `public.profiles`.

---

If the commands still don't render in VS Code chat, opening this file will show them directly in the editor.
