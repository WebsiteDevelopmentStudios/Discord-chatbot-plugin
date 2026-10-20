// Browser-only inference for custom, browser-compatible ONNX exports of the Zoi adapters.
// Raw PEFT adapter folders are not browser model packages; see WEBGPU_MODEL_SETUP.md.
const ZOI_TRANSFORMERS_MODULE = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
const pipelines = new Map();

function configuredModelId(model) {
  const models = window.ZOI_WEBGPU_MODELS || {};
  const id = typeof models[model] === "string" ? models[model].trim() : "";
  return id;
}

async function loadPipeline(model, onProgress = () => {}) {
  const modelId = configuredModelId(model);
  if (!modelId) {
    throw new Error(
      'The browser WebGPU export for "' + model + '" is not configured. Export the selected PEFT adapter to a Transformers.js-compatible ONNX model and set its public model ID in public/config.js.'
    );
  }
  if (!("gpu" in navigator)) {
    throw new Error("This browser does not expose WebGPU. Try a current version of Chrome or Edge on a WebGPU-capable device.");
  }
  if (!pipelines.has(model)) {
    const promise = (async () => {
      onProgress("Loading the browser WebGPU runtime…");
      const { env, pipeline } = await import(ZOI_TRANSFORMERS_MODULE);
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      onProgress("Downloading model files for " + model + ". The first load can be several gigabytes.");
      return pipeline("text-generation", modelId, {
        device: "webgpu",
        dtype: "fp16",
        progress_callback: (event) => {
          if (event && typeof event.status === "string") {
            const file = event.file ? " · " + event.file : "";
            const percent = Number.isFinite(event.progress) ? " · " + Math.round(event.progress) + "%" : "";
            onProgress(event.status + file + percent);
          }
        }
      });
    })();
    pipelines.set(model, promise);
    try {
      return await promise;
    } catch (error) {
      pipelines.delete(model);
      throw error;
    }
  }
  onProgress("Using the model already loaded in this tab…");
  return pipelines.get(model);
}

async function generate(model, message, onProgress = () => {}) {
  const generator = await loadPipeline(model, onProgress);
  onProgress("Generating on this device with WebGPU…");
  const output = await generator(
    [{ role: "user", content: message }],
    { max_new_tokens: 256, do_sample: true, temperature: 0.7, top_p: 0.9, return_full_text: false }
  );
  const generated = output?.[0]?.generated_text;
  let text = "";
  if (typeof generated === "string") text = generated;
  else if (Array.isArray(generated)) {
    const assistant = [...generated].reverse().find((item) => item?.role === "assistant");
    text = typeof assistant?.content === "string" ? assistant.content : "";
  }
  if (!text.trim()) throw new Error("The WebGPU model returned an empty response.");
  return text.trim();
}

window.ZoiWebGPU = {
  isSupported: () => "gpu" in navigator,
  configured: (model) => Boolean(configuredModelId(model)),
  modelId: configuredModelId,
  generate
};
