# Migration Guide — Python → TypeScript v4

## Step 1 — Replace API_Bot

```cmd
cd C:\Users\USER\OneDrive\Documents\Business\LiebeTagLogistics
git rm -r --cached API_Bot/
rmdir /s /q API_Bot
```
Extract this zip, place `API_Bot/` folder in repo.

## Step 2 — Replace Web

```cmd
git rm -r --cached Web/
rmdir /s /q Web
```
Place `Web/` folder from this zip in repo.

## Step 3 — Push

```cmd
git add API_Bot/ Web/
git commit -m "v4 - TypeScript rewrite (Bun + Hono + Prisma + Errands + React Dashboard)"
git push origin main
```

## Step 4 — Update Render settings

| Setting | New Value |
|---------|-----------|
| Runtime | Node |
| Root Directory | API_Bot |
| Build | `npm install -g bun && bun install && bunx prisma generate && bunx prisma db push` |
| Start | `bun src/index.ts` |

## Step 5 — Environment variables (no changes needed)

All existing env vars work unchanged. Just confirm:
- `CANTRACK_MDS_TOKEN = f8989b7a2dfd4c6ab524882d308dc66f`
- `CANTRACK_SCHOOL_ID = a0882f1c-821f-4852-bccd-4ef7a3e69b08`
- `CANTRACK_SESSION   = cbb3mwcrjeyljhev34zpcry0`
- `ANTHROPIC_API_KEY  = your_key`
- `OPENAI_API_KEY     = your_rotated_key`

## Step 6 — Web Dashboard

Open `Web/` locally:
```cmd
cd Web
npm install
npm run dev
```
Or deploy Web/ as a separate Render Static Site pointing to `dist/` after `npm run build`.
