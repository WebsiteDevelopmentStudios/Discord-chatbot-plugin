# Legacy inference notes

This file documents a previous Colab/tunnel approach and is retained only for repository history. It is **not part of the current deployment plan**.

The current target is a web GUI hosted on Cloudflare Pages or Vercel, with the Node.js API, Discord OAuth handling, and local SQLite database on Bot-Hosting.net. No Colab runtime or temporary tunnel is required by the dashboard architecture.

The custom `meta-llama/Llama-3.1-8B-Instruct` base model and the `zoi` / `zoi-unfiltered` PEFT adapters still need a compatible inference runtime. Do not claim adapter inference is working until that runtime has been deployed and both adapters have been tested. See [README.md](../README.md) and [BOT_HOSTING_SETUP.md](../BOT_HOSTING_SETUP.md).
