# Run the two Zoi adapters in free Google Colab

This runs the trained adapters from your existing Google Drive folders. It does not retrain them or upload the weights to a model-hosting vendor.

## Important limits

- Colab's free GPU is best-effort. Availability, runtime length, and idle disconnects are not guaranteed.
- A request can reach the Render API while Colab is alive, but **nothing can wake a terminated Colab runtime from an HTTP request**. You must reopen/run the Colab notebook after its session ends. The Render API returns HTTP 503 when the worker is unavailable rather than pretending the local fallback used your trained adapter.
- This is a prototype. Keep the tunnel URL and inference token private. A free tunnel URL is not a permanent service address.
- The base model is gated on Hugging Face for some accounts. Accept its license and configure `HF_TOKEN` in the Colab runtime secrets if required. Never put that token in this repository or the browser.

## Colab steps

1. Create a new Colab notebook and select a GPU runtime (Runtime → Change runtime type → T4 GPU if offered).
2. Run:

```python
from google.colab import drive
drive.mount('/content/drive')
```

3. Confirm both existing adapter folders contain `adapter_config.json`:
   - `/content/drive/MyDrive/Zoi/llama31-8b-zoi`
   - `/content/drive/MyDrive/Zoi/llama31-8b-zoi-unfiltered`
4. Install dependencies:

```python
!pip install -q -r https://raw.githubusercontent.com/WebsiteDevelopmentStudios/Discord-chatbot-plugin/feat/dual-adapter-inference-api/inference/requirements.txt
```

5. Set a strong random shared secret in the Colab process and the Render environment. Generate one in Colab:

```python
import secrets
print(secrets.token_urlsafe(48))
```

Copy the value privately. Do not paste it into notebook cells saved to GitHub or send it in chat. Set it as an environment variable in the live Colab runtime:

```python
import os
os.environ["ZOI_INFERENCE_TOKEN"] = "PASTE_SECRET_IN_COLAB_RUNTIME_ONLY"
# If Hugging Face requires authentication:
# os.environ["HF_TOKEN"] = "PASTE_HF_TOKEN_IN_RUNTIME_ONLY"
```

6. Start the server in a background cell:

```python
import subprocess, sys
server = subprocess.Popen([
    sys.executable, "-m", "uvicorn", "colab_server:app",
    "--host", "0.0.0.0", "--port", "7860"
], cwd="/content")
```

For that command to import the server file, first download the repo's `inference/colab_server.py` to `/content/colab_server.py`:

```python
!wget -q https://raw.githubusercontent.com/WebsiteDevelopmentStudios/Discord-chatbot-plugin/feat/dual-adapter-inference-api/inference/colab_server.py -O /content/colab_server.py
```

Wait for both adapters to load before opening the tunnel. In a separate cell, install and run a tunnel tool you trust (for example, Cloudflare's temporary `cloudflared` tunnel). Keep the generated HTTPS URL private. The tunnel must forward to `http://127.0.0.1:7860`.

## Render environment

On the existing `discord-chatbot-intelligence-api` service, add:

- `ZOI_INFERENCE_URL`: the private HTTPS tunnel base URL, without a trailing slash
- `ZOI_INFERENCE_TOKEN`: the exact same random secret set in Colab
- `ZOI_INFERENCE_TIMEOUT_MS`: `120000`

Do not set the inference token in public frontend code. The API forwards it server-to-server. Once the worker is running, check `/health` on the Render API and create a new key for each adapter using the selector on the API page.

## Smoke test

The Render API's normal public key is used for chat. Do not call the Colab worker directly from a browser. If Colab stops, restart the notebook and update `ZOI_INFERENCE_URL` in Render if the temporary tunnel URL changes.
