# Dryad

Vite + React website, Node/SQLite account and licensing service, and a Windows .NET launcher for the Dryad overlay.

The current setup instructions, feature status, selected pricing and production dependencies are in [DRYAD.md](DRYAD.md). The original architecture proposal is retained in [ARCHITECTURE.md](ARCHITECTURE.md).

```powershell
cd C:\Users\david\Dump\GameDump\ClashofClans\web
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173. Keep the existing `.env`; never overwrite configured credentials. The Stripe CLI is installed locally. See the runbook for the explicit event list required by `stripe listen`.

```powershell
npm.cmd test
npm.cmd run build
```

The website and protected native build are ready for local testing. Live payments, domain deployment, production publisher signing, PostgreSQL/object-storage adapters, and SMTP delivery are not complete.
