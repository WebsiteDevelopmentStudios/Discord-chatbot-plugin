# Browser WebGPU model setup

The dashboard's **Test your custom model** action now uses WebGPU in the browser. It first validates the API key with the Bot-Hosting.net API, reads the adapter assigned to that key, then runs generation in the browser. The prompt is not sent to the backend inference endpoint.

## Important: export the custom adapters first

The files in these Google Drive folders are PEFT adapter checkpoints, not complete browser model packages:

- `llama31-8b-zoi`
- `llama31-8b-zoi-unfiltered`

Transformers.js cannot load a raw PEFT folder as if it were a complete ONNX language model. Each adapter must be merged with the exact base model and exported to a Transformers.js-compatible ONNX layout. Llama 3.1 8B is large; downloading and running it in a browser requires substantial memory, storage, bandwidth, and a WebGPU-capable device. A first download may be several gigabytes.

Google Drive can remain the source/archive for the base and adapter files, but a Drive folder share link is not a model repository URL. The browser runtime needs the exported model files at a public HTTPS location with correct CORS and range-request support. Use a public model repository or a CORS-enabled static model host for the **exported** files. Do not put access tokens or private credentials in `public/config.js`.

## 1. Merge one PEFT adapter with the base model

Run this in a GPU/large-RAM Colab notebook after mounting Google Drive and ensuring the base model is available. If the base model is gated on Hugging Face, authenticate in the notebook using a secret/token there; do not commit it to this repository.

Install the merge dependencies:

```bash
pip install -U torch transformers peft accelerate safetensors
```

Example Python for the original adapter (adjust the two paths to match your Drive):

```python
from google.colab import drive
drive.mount("/content/drive")

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
ADAPTER_DIR = "/content/drive/MyDrive/Zoi/llama31-8b-zoi"
OUTPUT_DIR = "/content/zoi-merged"

# If required, pass token=True or token=your_notebook_secret to from_pretrained.
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=True)
base = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16,
    low_cpu_mem_usage=True,
    token=True,
)
model = PeftModel.from_pretrained(base, ADAPTER_DIR)
model = model.merge_and_unload()
model.save_pretrained(OUTPUT_DIR, safe_serialization=True, max_shard_size="2GB")
tokenizer.save_pretrained(OUTPUT_DIR)
print("Merged model saved to", OUTPUT_DIR)
```

Repeat with `ADAPTER_DIR = "/content/drive/MyDrive/Zoi/llama31-8b-zoi-unfiltered"` and a different output directory for the unfiltered adapter. Check the model/adapter licenses and keep the exports private if you are not permitted to redistribute them.

## 2. Export each merged model to ONNX for Transformers.js

Use the Hugging Face Optimum ONNX exporter in the same notebook:

```bash
pip install -U "optimum[onnxruntime]" onnx
optimum-cli export onnx --model /content/zoi-merged --task text-generation-with-past --dtype fp16 /content/zoi-onnx
```

This is an export starting point, not a guarantee that every Optimum output is immediately compatible with every Transformers.js release. Verify that the output has the decoder/ONNX files and configuration expected by Transformers.js' `text-generation` pipeline, then run a local test before publishing it. Do not upload a model until you have verified the exact exported file layout and generation works. Browser support for individual operators and model sizes varies by browser/GPU.

Publish each verified ONNX export to a public repository or static host that serves every file over HTTPS and permits browser CORS requests. Use separate locations/repositories for the two adapters so their weights cannot be confused.

## 3. Configure the dashboard

Edit `public/config.js`:

```js
window.ZOI_API_BASE = "https://YOUR-BOT-API-HOST";
window.ZOI_WEBGPU_MODELS = {
  zoi: "YOUR_PUBLIC_OWNER/zoi-webgpu-onnx",
  "zoi-unfiltered": "YOUR_PUBLIC_OWNER/zoi-unfiltered-webgpu-onnx"
};
```

The model values must be public Transformers.js-compatible model repository IDs, not the original PEFT folder names and not Google Drive folder URLs. Commit only public configuration. Deploy the updated `public/` directory to Cloudflare Pages and keep `WEB_ORIGIN` on the API set to that exact Pages origin.

## 4. Test

1. Open the dashboard on HTTPS in a current WebGPU-capable browser.
2. Sign in with Discord and create/choose an API key for the adapter you want to test.
3. Send a short prompt. The API validates the key, and the browser downloads/caches that adapter's exported model and generates locally.
4. Repeat with a key assigned to the other adapter.
5. Check browser developer tools if loading fails; typical causes are an unconfigured model ID, private repository, missing ONNX files, CORS restrictions, unsupported WebGPU operators, or insufficient device memory.

## Scope and API behavior

- Browser WebGPU is used by the dashboard's test-message UI only.
- API-key creation, ownership, revocation, Discord OAuth, and SQLite remain on the Node API.
- The server-side `POST /v1/chat/completions` endpoint still requires a server-accessible inference runtime. A browser's GPU cannot be used by arbitrary remote API clients; the browser-local test does not magically make the server endpoint work.
- The frontend does not fall back to Gemini, Groq, or any other model provider.
- The API key is sent to the backend only for validation. The prompt and generated text stay in the browser.
