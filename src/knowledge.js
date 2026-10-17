import { normalizeForUnderstanding, fuzzyTermMatch } from "./language.js";

// Curated, searchable facts for the no-model intelligence engine.
// This is retrieval over authored knowledge, not a claim of learned or live knowledge.
const DOCUMENTS = [
  { id:"api", title:"APIs", terms:["api","application programming interface","endpoint","rest api","api request"], text:"An API (application programming interface) is a contract that lets software communicate through defined operations and data formats. An endpoint is a particular URL and method. A REST API commonly uses HTTP methods: GET reads, POST creates or submits, PUT replaces, PATCH partially updates, and DELETE removes. Requests often carry JSON, and responses include an HTTP status code." },
  { id:"json", title:"JSON", terms:["json","javascript object notation","parse json","stringify"], text:"JSON is a text format for structured data. It supports objects, arrays, strings, numbers, booleans, and null; it does not support comments, functions, or undefined. In JavaScript, JSON.parse converts JSON text into a value and JSON.stringify converts a value into JSON text." },
  { id:"http", title:"HTTP and HTTPS", terms:["http","https","tls","status code","http request"], text:"HTTP is a request/response protocol used by websites and APIs. HTTPS is HTTP protected by TLS encryption. Common status codes include 200 (success), 201 (created), 400 (bad request), 401 (missing or invalid authentication), 403 (forbidden), 404 (not found), 429 (rate limited), and 500 (server error)." },
  { id:"api-keys", title:"API keys and authentication", terms:["api key","apikey","bearer token","authorization header","authentication","auth"], text:"An API key is a credential used to identify or authorize a client. Send it in a secure Authorization header when the API expects that format, never commit secret keys to a repository, and do not place them in URLs. Authentication establishes who or what is calling; authorization determines what it may do. Rotate a key if it leaks and apply rate limits." },
  { id:"ai", title:"Artificial intelligence", terms:["artificial intelligence"," ai ","machine learning","neural network"], text:"Artificial intelligence (AI) is a broad field concerned with systems that perform tasks such as language processing, perception, planning, and decision support. Machine learning is a subset of AI in which systems fit patterns from examples. A neural network is a parameterized function composed of connected layers, trained by adjusting its parameters against data and an objective." },
  { id:"llm", title:"Large language models", terms:["large language model","llm","language model","transformer","token prediction"], text:"A large language model (LLM) is a neural network trained on large text collections to model sequences of tokens. Modern LLMs commonly use transformer architectures and can generalize across many language tasks, but can still hallucinate, miss context, or produce biased or outdated answers. A rules-based chatbot does not become an LLM simply by having many rules; it lacks learned model weights and broad generalization." },
  { id:"rules-vs-llm", title:"Rules-based chatbot vs trained model", terms:["rule based","rules-based","no model","without a model","free ai","make ai smarter","smarter chatbot"], text:"A rules-based chatbot can be improved with better intent detection, a larger curated knowledge base, retrieval, memory, tools, and tests, but it cannot match the open-ended generalization of a capable trained language model using rules alone. A genuinely stronger no-paid-API design can optionally run an open-weight model locally, but inference still needs CPU/RAM or a GPU; the software may be free while compute is not necessarily free." },
  { id:"javascript", title:"JavaScript", terms:["javascript","js language","promise","async await"], text:"JavaScript is a programming language used in browsers and server applications. It has dynamic types, first-class functions, objects, modules, and an event loop. Promise represents a result that may become available later; async functions return promises, and await lets code pause until a promise settles." },
  { id:"node", title:"Node.js", terms:["node.js","nodejs","node js","npm","package.json"], text:"Node.js is a runtime that executes JavaScript outside the browser, commonly for servers, command-line tools, and automation. npm manages packages and scripts. package.json declares project metadata, scripts, dependencies, and runtime constraints. Node's built-in HTTP, filesystem, crypto, and test modules can support small services without third-party dependencies." },
  { id:"git", title:"Git and GitHub", terms:["git","github","commit","branch","pull request","repository"], text:"Git is a version-control system that records changes as commits. A branch is a movable line of development, and a merge combines changes. GitHub hosts Git repositories and adds collaboration features such as pull requests, issues, and Actions workflows. A commit is a snapshot plus metadata, not simply a backup of one file." },
  { id:"tests", title:"Software tests", terms:["unit test","automated test","testing","test suite","regression"], text:"A unit test checks a small behavior in isolation; an integration test checks that components work together; an end-to-end test exercises a full workflow. Regression tests preserve known behavior while code changes. Good tests cover normal inputs, edge cases, invalid inputs, and failures, and should be run before treating a change as verified." },
  { id:"security", title:"Web security basics", terms:["security","secret","environment variable","sql injection","xss","rate limit"], text:"Basic web-service security includes validating input, limiting request sizes, authenticating protected routes, authorizing each action, rate limiting, keeping secrets out of source control, using HTTPS, and avoiding unsafe evaluation of user text. Environment variables can provide deployment secrets, but access to the deployment environment must also be controlled. Never trust client-provided identity or permissions." },
  { id:"databases", title:"Databases", terms:["database","sql","postgres","sqlite","persistent storage","database table"], text:"A database stores structured information beyond the lifetime of one process. Relational databases such as PostgreSQL and SQLite organize data into tables and use SQL. A primary key identifies a row; a transaction groups operations so they succeed or fail together. In-memory Maps are fast but are normally lost when a process restarts." },
  { id:"memory", title:"Chatbot memory and context", terms:["conversation memory","chat history","context window","remember","memory"], text:"Conversation context is the recent messages used to interpret a new turn. Persistent memory is information deliberately saved for future conversations. They are different: replaying a message history does not automatically create durable memory. Production chat systems should isolate memory by user or conversation, limit stored data, provide deletion/reset controls, and avoid retaining sensitive details unnecessarily." },
  { id:"embeddings", title:"Semantic search and embeddings", terms:["embedding","vector search","semantic search","similarity search","retrieval augmented generation","rag"], text:"An embedding maps text into a numeric vector so texts with related meanings can be compared by distance or similarity. Semantic search retrieves passages by meaning rather than requiring exact word matches. Retrieval-augmented generation (RAG) finds relevant documents and gives them to a language model as context; retrieval can also help a rules-based system find authored facts, but retrieval alone does not generate new reasoning." },
  { id:"reasoning", title:"Reasoning and confidence", terms:["reasoning","confidence score","chain of thought","logic"], text:"Reliable reasoning involves breaking a problem into explicit steps, checking assumptions, using tools for verifiable calculations or facts, and testing the result. A confidence score is only meaningful if calibrated against observed outcomes; a hard-coded number is not proof that an answer is correct. Systems should distinguish retrieved facts, calculations, inferences, and uncertainty." },
  { id:"render", title:"Render hosting", terms:["render","render.com","deployment","deploy","hosting","web service"], text:"Render can run a web service from a repository and expose it over HTTPS. The service must bind to the port supplied by the PORT environment variable and listen on an externally reachable interface. Deployments and restarts can replace the process; local filesystem changes may not be durable unless persistent storage is configured. Keep API secrets in environment settings and inspect build/runtime logs when a deployment fails." },
  { id:"discord-bots", title:"Discord bots", terms:["discord bot","discord.js","discord interaction","discord gateway","slash command"], text:"A Discord bot is an application registered in the Discord Developer Portal and authorized to a server with appropriate scopes and permissions. Bots can receive gateway events or handle interactions. Slash commands are application commands and require command registration; message-content access is a separate privileged intent for reading ordinary message text. Bot tokens are secrets and must never be published." },
  { id:"minecraft-server", title:"Minecraft servers and plugins", terms:["minecraft server","paper server","spigot plugin","minecraft plugin","geyser","bedrock crossplay"], text:"Paper is a performance-focused server implementation compatible with many Bukkit/Spigot plugins. Plugins must be compatible with the server version and Java runtime; internal server APIs can change between versions. Geyser translates between Bedrock and Java protocol behavior for cross-play, but compatibility depends on the Minecraft versions, server configuration, network ports, and plugins." },
  { id:"java", title:"Java", terms:["java programming","jvm","jdk","java runtime"], text:"Java is a statically typed programming language compiled to bytecode for the Java Virtual Machine (JVM). A JDK includes tools for compiling and developing Java programs; a runtime is used to execute them. Java and JavaScript are distinct languages despite their similar names." },
  { id:"python", title:"Python", terms:["python programming","python language","pip","virtual environment"], text:"Python is a high-level programming language known for readable syntax and a broad ecosystem. pip installs packages, while a virtual environment isolates a project's dependencies. Python is commonly used for automation, data analysis, web services, and machine learning." },
  { id:"html-css", title:"HTML and CSS", terms:["html","css","web page","responsive design"], text:"HTML describes the structure and meaning of web content; CSS controls presentation such as layout, color, spacing, and responsive behavior. JavaScript adds interaction. Responsive design adapts layouts to different screen sizes, commonly using flexible layouts, media queries, and accessible controls." },
  { id:"networking", title:"DNS and ports", terms:["dns","domain name","port","tcp","udp","ip address"], text:"DNS translates domain names into records such as IP addresses. An IP address identifies a network interface, while a port identifies a service endpoint on a host. TCP provides a reliable ordered byte stream; UDP sends independent datagrams without TCP's delivery guarantees. Firewalls and hosting configuration must allow the required traffic." },
  { id:"algorithms", title:"Algorithms and complexity", terms:["algorithm","big o","time complexity","space complexity","sorting"], text:"An algorithm is a defined procedure for solving a problem. Big O notation describes how resource use grows as input size increases. O(1) is constant, O(log n) grows logarithmically, O(n) linearly, and O(n²) quadratically. Big O describes growth rather than exact runtime on a particular computer." },
  { id:"math-percent", title:"Percentages", terms:["percentage","percent","discount","percent increase"], text:"A percentage is a ratio per hundred. To find p percent of x, calculate x × p / 100. To apply a discount of p percent, multiply the original price by (1 − p/100). Percent change is (new − old) / old × 100, provided the old value is not zero." },
  { id:"climate", title:"Weather vs climate", terms:["weather","climate","global warming","climate change"], text:"Weather describes short-term atmospheric conditions, such as today's temperature or rain. Climate describes statistical patterns over longer periods, typically decades. Climate change refers to lasting shifts in those patterns; current global warming is primarily driven by human greenhouse-gas emissions." },
  { id:"photosynthesis", title:"Photosynthesis", terms:["photosynthesis","plants make food","chlorophyll"], text:"Photosynthesis is the process by which plants, algae, and some bacteria use light energy to convert carbon dioxide and water into energy-rich sugars, releasing oxygen in oxygenic photosynthesis. Chlorophyll and related pigments absorb light; the process also depends on water, carbon dioxide, and suitable conditions." },
  { id:"gravity", title:"Gravity", terms:["gravity","gravity force","newton","relativity"], text:"Gravity is the attraction associated with mass and energy. In Newtonian physics it is modeled as a force between masses; in general relativity it is described as curvature of spacetime. Near Earth's surface, objects in free fall accelerate at about 9.8 metres per second squared, ignoring air resistance." },
  { id:"electricity", title:"Electricity basics", terms:["voltage","current","resistance","ohm law","electricity"], text:"Voltage is electric potential difference, current is the rate of electric charge flow, and resistance describes opposition to current. Ohm's law for an ohmic component is V = I × R. Electrical safety depends on voltage, current path, exposure time, and the environment; do not handle live mains wiring without appropriate training." },
  { id:"privacy", title:"Privacy and personal data", terms:["privacy","personal data","data retention","delete my data"], text:"Data minimization means collecting only what a service needs. Sensitive data should be protected in transit and at rest, access should be limited, retention should have a purpose, and users should have clear deletion/reset controls. Conversation memory should not be treated as private merely because it is not displayed publicly." },
  { id:"free-models", title:"Free and open-weight AI models", terms:["open source model","open weight model","local llm","run model locally","free ai model"], text:"Some language models publish weights that can be downloaded and run locally under their respective licenses. This avoids a paid hosted-model API, but does not eliminate compute costs: RAM, CPU/GPU performance, storage, electricity, and hosting limits matter. Small quantized models can run on modest hardware but may be less capable; check the model's license and hardware requirements before deployment." },
  { id:"rate-limits", title:"Rate limiting", terms:["rate limit","429","too many requests","throttling"], text:"Rate limiting restricts how frequently a client can call a service. It helps protect availability, control costs, and reduce abuse. A production limiter should use a stable client identity, handle proxies carefully, return HTTP 429 when appropriate, and use shared storage if multiple server instances must enforce one limit." },
  { id:"cors", title:"CORS", terms:["cors","cross origin","origin policy","browser api request"], text:"CORS (Cross-Origin Resource Sharing) is a browser security mechanism that lets a server state which origins may read cross-origin responses. It is enforced by browsers, not a replacement for authentication or authorization. A server-to-server request is not blocked by browser CORS rules." },
  { id:"async", title:"Asynchronous programming", terms:["asynchronous","async","await","event loop","non blocking"], text:"Asynchronous programming lets a program start an operation and continue doing other work while it waits. In Node.js, promises and async/await help coordinate I/O such as network requests. CPU-heavy synchronous work can block the event loop and delay every request handled by that process." },
  { id:"error-debugging", title:"Debugging errors", terms:["debug","stack trace","error message","troubleshoot","bug"], text:"A useful debugging workflow is to reproduce the problem, read the first meaningful error and stack trace, identify the failing component, check versions and configuration, make one focused change, and rerun a minimal reproduction plus tests. Avoid changing many unrelated files at once; preserve logs and distinguish the root cause from later cascading errors." },
  { id:"passwords", title:"Password storage", terms:["password hashing","bcrypt","argon2","salt","password"], text:"Passwords should not be stored as plaintext or encrypted with a reversible scheme. Store a salted password hash using a password-hashing algorithm designed to be slow, such as Argon2id, scrypt, or bcrypt, with appropriate parameters. API keys are usually high-entropy random secrets and can often be stored as cryptographic hashes for verification." },
  { id:"encryption", title:"Encryption and hashing", terms:["encryption","hashing","sha-256","cryptography"], text:"Encryption is reversible with the correct key and is used to protect confidentiality. Hashing maps data to a digest and is not designed to be reversed. SHA-256 is a general-purpose cryptographic hash, not a password-hashing algorithm by itself. Use established libraries and protocols rather than inventing cryptography." },
  { id:"environment", title:"Environment variables", terms:["environment variable","env var","process.env","configuration"], text:"Environment variables let deployments provide configuration without hard-coding it in source files. In Node.js, process.env reads them as strings. Validate required values at startup, never print secrets to logs, and remember that environment variables are configuration—not a substitute for access controls on the hosting account." },
  { id:"http-methods", title:"HTTP methods", terms:["get vs post","http methods","put vs patch","get request","post request"], text:"GET is intended to retrieve a representation and should not perform state-changing actions. POST submits data or triggers an operation, often creating a resource. PUT generally replaces a resource representation, PATCH applies partial changes, and DELETE requests removal. Servers should validate the method and authorization for each route." },
  { id:"git-merge", title:"Merge conflicts", terms:["merge conflict","git conflict","conflicting changes"], text:"A Git merge conflict occurs when Git cannot automatically reconcile overlapping changes. Open each conflicted file, inspect the conflict markers, choose or combine the intended content, remove the markers, run tests, then stage and commit the resolution. Do not blindly accept one side without understanding the changes." }
,
  { id:"internet", title:"How the internet works", terms:["internet","world wide web","websites","browser","internet connection","website not loading"], text:"The internet is a global network of interconnected networks that route data using protocols such as IP and TCP. DNS translates domain names into records, routers forward packets, and HTTP or HTTPS carries many web requests. The World Wide Web is a service that runs on the internet; the internet also supports email, games, voice calls, and other services." },
  { id:"computer-memory", title:"RAM and storage", terms:["ram","computer memory","memory vs storage","random access memory","ssd","hard drive"], text:"RAM is fast, temporary working memory used by running programs; its contents are normally lost when power is removed. Storage such as an SSD or hard drive keeps files and programs when the computer is off. More RAM helps when active programs need more working space, while faster storage can improve loading and file operations." },
  { id:"operating-systems", title:"Operating systems", terms:["operating system","windows","linux","macos","android","ios","os"], text:"An operating system manages hardware and provides services for applications, including processes, memory, files, networking, and permissions. Windows, Linux, macOS, Android, and iOS are examples. A process is a running program; the operating system schedules CPU time and isolates processes to improve reliability and security." },
  { id:"algorithms", title:"Algorithms and complexity", terms:["algorithm","big o","time complexity","space complexity","sorting","search algorithm"], text:"An algorithm is a finite procedure for solving a problem. Time complexity describes how running time grows with input size; space complexity describes how memory use grows. Big O notation expresses an upper growth bound, such as O(n) for scanning a list and O(log n) for binary search on sorted data. Big O describes scaling, not an exact runtime." },
  { id:"probability", title:"Probability and statistics", terms:["probability","statistics","average","mean median mode","correlation","sample size"], text:"Probability quantifies how likely an event is, from 0 (impossible) to 1 (certain). The mean is the arithmetic average, the median is the middle value after sorting, and the mode is the most frequent value. Correlation describes association between variables but does not by itself establish that one causes the other. Small or biased samples can produce misleading conclusions." },
  { id:"evolution", title:"Evolution by natural selection", terms:["evolution","natural selection","species evolve","adaptation","genetics"], text:"Evolution is change in heritable characteristics of populations across generations. Natural selection occurs when inherited variations affect survival or reproduction, causing some variants to become more common over time. Mutation and recombination generate variation, while genetic drift and gene flow also influence populations. Individuals do not evolve genetically during their own lifetime in the population-level sense." },
  { id:"climate", title:"Climate change", terms:["climate change","global warming","greenhouse gases","carbon emissions","weather vs climate"], text:"Weather describes short-term atmospheric conditions; climate describes patterns over longer periods. Human-caused climate change is primarily driven by greenhouse gases, especially carbon dioxide from burning fossil fuels, that trap outgoing heat. Evidence includes rising global average temperatures, warming oceans, shrinking glaciers, and rising sea levels. Individual weather events vary naturally, while climate trends are evaluated over many years." },
  { id:"electricity", title:"Electricity basics", terms:["electricity","voltage","current","resistance","ohms law","circuit"], text:"Voltage is electrical potential difference, current is the flow of electric charge, and resistance opposes that flow. Ohm's law relates them as V = I × R for an ohmic component under applicable conditions. A circuit needs a conducting path for sustained current. Real electrical work can be dangerous; mains wiring and high-energy batteries should be handled by qualified people." },
  { id:"space", title:"Stars, planets, and galaxies", terms:["space","astronomy","planet","star","galaxy","solar system","black hole"], text:"A star produces energy through nuclear fusion in its core. A planet orbits a star or stellar remnant and does not generate its own sustained fusion energy. A galaxy contains stars, gas, dust, dark matter, and other objects bound by gravity. Our Solar System is in the Milky Way galaxy. Black holes are regions where gravity is so strong that beyond the event horizon, light cannot escape." },
  { id:"writing", title:"Clear writing and explanations", terms:["how to write clearly","summarize","explanation","writing","grammar","proofread"], text:"Clear writing starts with the reader's goal. Put the main point first, use concrete words, organize related ideas together, and give examples for abstract concepts. A useful summary preserves the main claims and important qualifications without copying every detail. Proofreading should check meaning and structure as well as spelling, punctuation, and grammar." },
  { id:"critical-thinking", title:"Critical thinking and evidence", terms:["critical thinking","evaluate a claim","evidence","logical fallacy","fact checking","reasoning"], text:"Critical thinking means evaluating claims using evidence, logic, context, and alternative explanations. Separate observations from interpretations, check whether a source is reliable and current, and ask what evidence would change your mind. Correlation is not necessarily causation, a confident tone is not proof, and one anecdote may not represent a general pattern. When evidence is incomplete, state uncertainty explicitly." },
  { id:"machine-learning", title:"How machine learning works", terms:["machine learning","training data","inference","model training","overfitting","neural network training"], text:"Machine learning systems fit parameters from examples or feedback to perform a task. Training adjusts parameters using an objective and optimization procedure; inference uses the resulting model to produce predictions on new inputs. Overfitting occurs when a model learns training-specific patterns that do not generalize well. Good evaluation uses held-out data and measures performance on tasks resembling real use." }
];

const STOP = new Set(["the","and","for","that","this","with","what","when","where","which","who","why","how","are","is","was","were","does","did","can","could","would","should","tell","explain","about","into","from","have","has","your","you","its","their","them","than","then","please","help","define","mean","means"]);
function tokens(value) {
  return String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
function filterTerms(value) {
  return new Set(tokens(value).filter((term) => (term.length > 2 || term.length === 2) && !STOP.has(term)));
}
function queryTerms(value) {
  return filterTerms(normalizeForUnderstanding(value));
}
// Reference articles are already authored and do not need typo correction.
// Applying dictionary-based spelling recovery to every word in every article
// makes the first request unnecessarily slow. Tokenize article text directly
// and cache its term sets; normalize only the user's query.
const DOCUMENT_TERM_CACHE = new Map();
function documentTerms(document) {
  let cached = DOCUMENT_TERM_CACHE.get(document.id);
  if (!cached) {
    const title = filterTerms(document.title);
    const aliases = filterTerms(document.terms.join(" "));
    const body = filterTerms(document.text);
    cached = { all: new Set([...title, ...aliases, ...body]), title, aliases, body };
    DOCUMENT_TERM_CACHE.set(document.id, cached);
  }
  return cached.all;
}
function documentTermSets(document) {
  documentTerms(document);
  return DOCUMENT_TERM_CACHE.get(document.id);
}

// Weight rarer query terms more strongly than common words. This is still local
// lexical retrieval (not semantic embeddings), but it reduces matches caused by
// generic words and makes topic-specific terms count for more.
function scoreDocument(query, document) {
  const q = [...queryTerms(query)];
  if (!q.length) return 0;
  const cachedTerms = documentTermSets(document);
  const titleTerms = cachedTerms.title;
  const aliasTerms = cachedTerms.aliases;
  const bodyTerms = cachedTerms.body;
  const normalizedQuery = " " + normalizeForUnderstanding(query).replace(/[^\\p{L}\\p{N}]+/gu, " ").trim() + " ";
  let totalWeight = 0, matchedWeight = 0, titleWeight = 0, aliasWeight = 0, bodyWeight = 0;
  for (const term of q) {
    const documentFrequency = DOCUMENTS.reduce((count, candidate) => {
      const terms = documentTerms(candidate);
      return count + (fuzzyTermMatch(term, terms) ? 1 : 0);
    }, 0);
    const idf = Math.log(1 + (DOCUMENTS.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
    totalWeight += idf;
    const inTitle = fuzzyTermMatch(term, titleTerms);
    const inAlias = fuzzyTermMatch(term, aliasTerms);
    const inBody = fuzzyTermMatch(term, bodyTerms);
    if (inTitle || inAlias || inBody) matchedWeight += idf;
    if (inTitle) titleWeight += idf;
    if (inAlias) aliasWeight += idf;
    if (inBody) bodyWeight += idf;
  }
  if (!totalWeight) return 0;
  const coverage = matchedWeight / totalWeight;
  const titleBoost = titleWeight / totalWeight;
  const aliasBoost = aliasWeight / totalWeight;
  const bodyBoost = bodyWeight / totalWeight;
  const exactPhrase = document.terms.some((term) => {
    const phrase = term.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
    return phrase.length >= 3 && normalizedQuery.includes(" " + phrase + " ");
  });
  // Keep the score bounded and require real term coverage; a single incidental
  // word should not surface an unrelated document.
  return Math.min(1.5, coverage * 0.62 + titleBoost * 0.12 + aliasBoost * 0.16 + bodyBoost * 0.10 + (exactPhrase ? 0.28 : 0));
}

export function retrieveKnowledge(query) {
  const ranked = DOCUMENTS
    .map((document) => ({ document, score: scoreDocument(query, document) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.42) return null;
  // Only combine two passages when the query genuinely matches both, avoiding unrelated dumps.
  const second = ranked[1];
  if (second && second.score >= 0.58 && best.score - second.score < 0.13) {
    return {
      text: `**${best.document.title}:** ${best.document.text}\\n\\n**${second.document.title}:** ${second.document.text}`,
      topic: [best.document.id, second.document.id],
      score: Math.min(0.95, best.score)
    };
  }
  return { text: best.document.text, topic: best.document.id, score: Math.min(0.95, best.score) };
}

export function knowledgeTopics() {
  return DOCUMENTS.map(({ id, title }) => ({ id, title }));
}
