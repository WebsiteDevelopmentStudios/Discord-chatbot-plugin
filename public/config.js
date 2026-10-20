// Public configuration only. Never put Discord secrets or private tokens in this file.
window.ZOI_API_BASE = ""; // Set the public HTTPS origin of the Bot-Hosting.net API.

// Each value must identify a PUBLIC, Transformers.js-compatible ONNX export of the
// corresponding custom adapter merged into Llama 3.1 8B Instruct.
// Raw PEFT adapter folders, private Hugging Face repos, and Google Drive folder URLs
// are not directly loadable by this browser runtime. See WEBGPU_MODEL_SETUP.md.
window.ZOI_WEBGPU_MODELS = {
  zoi: "",
  "zoi-unfiltered": ""
};
