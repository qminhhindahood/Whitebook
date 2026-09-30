// hosted/node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}

// hosted/node_modules/jose/dist/webapi/lib/base64.js
function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(encoded);
  }
  const binary = atob(encoded);
  const bytes2 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes2[i] = binary.charCodeAt(i);
  }
  return bytes2;
}

// hosted/node_modules/jose/dist/webapi/util/base64url.js
function decode(input) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(typeof input === "string" ? input : decoder.decode(input), {
      alphabet: "base64url"
    });
  }
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}

// hosted/node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  [Symbol.asyncIterator];
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// hosted/node_modules/jose/dist/webapi/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
function checkUsage(key2, usage) {
  if (usage && !key2.usages.includes(usage)) {
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
  }
}
function checkSigCryptoKey(key2, alg, usage) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key2.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key2.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key2.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key2.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key2.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key2.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "Ed25519":
    case "EdDSA": {
      if (!isAlgorithm(key2.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87": {
      if (!isAlgorithm(key2.algorithm, alg))
        throw unusable(alg);
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key2.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key2.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key2, usage);
}

// hosted/node_modules/jose/dist/webapi/lib/invalid_key_input.js
function message(msg, actual, ...types) {
  types = types.filter(Boolean);
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else if (types.length === 2) {
    msg += `one of type ${types[0]} or ${types[1]}.`;
  } else {
    msg += `of type ${types[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
var invalid_key_input_default = (actual, ...types) => {
  return message("Key must be ", actual, ...types);
};
function withAlg(alg, actual, ...types) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types);
}

// hosted/node_modules/jose/dist/webapi/lib/is_key_like.js
function isCryptoKey(key2) {
  return key2?.[Symbol.toStringTag] === "CryptoKey";
}
function isKeyObject(key2) {
  return key2?.[Symbol.toStringTag] === "KeyObject";
}
var is_key_like_default = (key2) => {
  return isCryptoKey(key2) || isKeyObject(key2);
};

// hosted/node_modules/jose/dist/webapi/lib/is_disjoint.js
var is_disjoint_default = (...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
};

// hosted/node_modules/jose/dist/webapi/lib/is_object.js
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
var is_object_default = (input) => {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
};

// hosted/node_modules/jose/dist/webapi/lib/check_key_length.js
var check_key_length_default = (alg, key2) => {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key2.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
};

// hosted/node_modules/jose/dist/webapi/lib/jwk_to_key.js
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "AKP": {
      switch (jwk.alg) {
        case "ML-DSA-44":
        case "ML-DSA-65":
        case "ML-DSA-87":
          algorithm = { name: jwk.alg };
          keyUsages = jwk.priv ? ["sign"] : ["verify"];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
          algorithm = { name: "ECDSA", namedCurve: "P-256" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES384":
          algorithm = { name: "ECDSA", namedCurve: "P-384" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES512":
          algorithm = { name: "ECDSA", namedCurve: "P-521" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
        case "EdDSA":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
var jwk_to_key_default = async (jwk) => {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const keyData = { ...jwk };
  if (keyData.kty !== "AKP") {
    delete keyData.alg;
  }
  delete keyData.use;
  return crypto.subtle.importKey("jwk", keyData, algorithm, jwk.ext ?? (jwk.d || jwk.priv ? false : true), jwk.key_ops ?? keyUsages);
};

// hosted/node_modules/jose/dist/webapi/key/import.js
async function importJWK(jwk, alg, options) {
  if (!is_object_default(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  let ext;
  alg ??= jwk.alg;
  ext ??= options?.extractable ?? jwk.ext;
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
      return jwk_to_key_default({ ...jwk, alg, ext });
    case "AKP": {
      if (typeof jwk.alg !== "string" || !jwk.alg) {
        throw new TypeError('missing "alg" (Algorithm) Parameter value');
      }
      if (alg !== void 0 && alg !== jwk.alg) {
        throw new TypeError("JWK alg and alg option value mismatch");
      }
      return jwk_to_key_default({ ...jwk, ext });
    }
    case "EC":
    case "OKP":
      return jwk_to_key_default({ ...jwk, alg, ext });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}

// hosted/node_modules/jose/dist/webapi/lib/validate_crit.js
var validate_crit_default = (Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) => {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
};

// hosted/node_modules/jose/dist/webapi/lib/validate_algorithms.js
var validate_algorithms_default = (option, algorithms) => {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
};

// hosted/node_modules/jose/dist/webapi/lib/is_jwk.js
function isJWK(key2) {
  return is_object_default(key2) && typeof key2.kty === "string";
}
function isPrivateJWK(key2) {
  return key2.kty !== "oct" && (key2.kty === "AKP" && typeof key2.priv === "string" || typeof key2.d === "string");
}
function isPublicJWK(key2) {
  return key2.kty !== "oct" && typeof key2.d === "undefined" && typeof key2.priv === "undefined";
}
function isSecretJWK(key2) {
  return key2.kty === "oct" && typeof key2.k === "string";
}

// hosted/node_modules/jose/dist/webapi/lib/normalize_key.js
var cache;
var handleJWK = async (key2, jwk, alg, freeze = false) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(key2);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwk_to_key_default({ ...jwk, alg });
  if (freeze)
    Object.freeze(key2);
  if (!cached) {
    cache.set(key2, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
};
var handleKeyObject = (keyObject, alg) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(keyObject);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const isPublic = keyObject.type === "public";
  const extractable = isPublic ? true : false;
  let cryptoKey;
  if (keyObject.asymmetricKeyType === "x25519") {
    switch (alg) {
      case "ECDH-ES":
      case "ECDH-ES+A128KW":
      case "ECDH-ES+A192KW":
      case "ECDH-ES+A256KW":
        break;
      default:
        throw new TypeError("given KeyObject instance cannot be used for this algorithm");
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, isPublic ? [] : ["deriveBits"]);
  }
  if (keyObject.asymmetricKeyType === "ed25519") {
    if (alg !== "EdDSA" && alg !== "Ed25519") {
      throw new TypeError("given KeyObject instance cannot be used for this algorithm");
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
      isPublic ? "verify" : "sign"
    ]);
  }
  switch (keyObject.asymmetricKeyType) {
    case "ml-dsa-44":
    case "ml-dsa-65":
    case "ml-dsa-87": {
      if (alg !== keyObject.asymmetricKeyType.toUpperCase()) {
        throw new TypeError("given KeyObject instance cannot be used for this algorithm");
      }
      cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
        isPublic ? "verify" : "sign"
      ]);
    }
  }
  if (keyObject.asymmetricKeyType === "rsa") {
    let hash;
    switch (alg) {
      case "RSA-OAEP":
        hash = "SHA-1";
        break;
      case "RS256":
      case "PS256":
      case "RSA-OAEP-256":
        hash = "SHA-256";
        break;
      case "RS384":
      case "PS384":
      case "RSA-OAEP-384":
        hash = "SHA-384";
        break;
      case "RS512":
      case "PS512":
      case "RSA-OAEP-512":
        hash = "SHA-512";
        break;
      default:
        throw new TypeError("given KeyObject instance cannot be used for this algorithm");
    }
    if (alg.startsWith("RSA-OAEP")) {
      return keyObject.toCryptoKey({
        name: "RSA-OAEP",
        hash
      }, extractable, isPublic ? ["encrypt"] : ["decrypt"]);
    }
    cryptoKey = keyObject.toCryptoKey({
      name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
      hash
    }, extractable, [isPublic ? "verify" : "sign"]);
  }
  if (keyObject.asymmetricKeyType === "ec") {
    const nist = /* @__PURE__ */ new Map([
      ["prime256v1", "P-256"],
      ["secp384r1", "P-384"],
      ["secp521r1", "P-521"]
    ]);
    const namedCurve = nist.get(keyObject.asymmetricKeyDetails?.namedCurve);
    if (!namedCurve) {
      throw new TypeError("given KeyObject instance cannot be used for this algorithm");
    }
    if (alg === "ES256" && namedCurve === "P-256") {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg === "ES384" && namedCurve === "P-384") {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg === "ES512" && namedCurve === "P-521") {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg.startsWith("ECDH-ES")) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDH",
        namedCurve
      }, extractable, isPublic ? [] : ["deriveBits"]);
    }
  }
  if (!cryptoKey) {
    throw new TypeError("given KeyObject instance cannot be used for this algorithm");
  }
  if (!cached) {
    cache.set(keyObject, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
};
var normalize_key_default = async (key2, alg) => {
  if (key2 instanceof Uint8Array) {
    return key2;
  }
  if (isCryptoKey(key2)) {
    return key2;
  }
  if (isKeyObject(key2)) {
    if (key2.type === "secret") {
      return key2.export();
    }
    if ("toCryptoKey" in key2 && typeof key2.toCryptoKey === "function") {
      try {
        return handleKeyObject(key2, alg);
      } catch (err) {
        if (err instanceof TypeError) {
          throw err;
        }
      }
    }
    let jwk = key2.export({ format: "jwk" });
    return handleJWK(key2, jwk, alg);
  }
  if (isJWK(key2)) {
    if (key2.k) {
      return decode(key2.k);
    }
    return handleJWK(key2, key2, alg, true);
  }
  throw new Error("unreachable");
};

// hosted/node_modules/jose/dist/webapi/lib/check_key_type.js
var tag = (key2) => key2?.[Symbol.toStringTag];
var jwkMatchesOp = (alg, key2, usage) => {
  if (key2.use !== void 0) {
    let expected;
    switch (usage) {
      case "sign":
      case "verify":
        expected = "sig";
        break;
      case "encrypt":
      case "decrypt":
        expected = "enc";
        break;
    }
    if (key2.use !== expected) {
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
    }
  }
  if (key2.alg !== void 0 && key2.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  }
  if (Array.isArray(key2.key_ops)) {
    let expectedKeyOp;
    switch (true) {
      case (usage === "sign" || usage === "verify"):
      case alg === "dir":
      case alg.includes("CBC-HS"):
        expectedKeyOp = usage;
        break;
      case alg.startsWith("PBES2"):
        expectedKeyOp = "deriveBits";
        break;
      case /^A\d{3}(?:GCM)?(?:KW)?$/.test(alg):
        if (!alg.includes("GCM") && alg.endsWith("KW")) {
          expectedKeyOp = usage === "encrypt" ? "wrapKey" : "unwrapKey";
        } else {
          expectedKeyOp = usage;
        }
        break;
      case (usage === "encrypt" && alg.startsWith("RSA")):
        expectedKeyOp = "wrapKey";
        break;
      case usage === "decrypt":
        expectedKeyOp = alg.startsWith("RSA") ? "unwrapKey" : "deriveBits";
        break;
    }
    if (expectedKeyOp && key2.key_ops?.includes?.(expectedKeyOp) === false) {
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
    }
  }
  return true;
};
var symmetricTypeCheck = (alg, key2, usage) => {
  if (key2 instanceof Uint8Array)
    return;
  if (isJWK(key2)) {
    if (isSecretJWK(key2) && jwkMatchesOp(alg, key2, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key2)) {
    throw new TypeError(withAlg(alg, key2, "CryptoKey", "KeyObject", "JSON Web Key", "Uint8Array"));
  }
  if (key2.type !== "secret") {
    throw new TypeError(`${tag(key2)} instances for symmetric algorithms must be of type "secret"`);
  }
};
var asymmetricTypeCheck = (alg, key2, usage) => {
  if (isJWK(key2)) {
    switch (usage) {
      case "decrypt":
      case "sign":
        if (isPrivateJWK(key2) && jwkMatchesOp(alg, key2, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "encrypt":
      case "verify":
        if (isPublicJWK(key2) && jwkMatchesOp(alg, key2, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key2)) {
    throw new TypeError(withAlg(alg, key2, "CryptoKey", "KeyObject", "JSON Web Key"));
  }
  if (key2.type === "secret") {
    throw new TypeError(`${tag(key2)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (key2.type === "public") {
    switch (usage) {
      case "sign":
        throw new TypeError(`${tag(key2)} instances for asymmetric algorithm signing must be of type "private"`);
      case "decrypt":
        throw new TypeError(`${tag(key2)} instances for asymmetric algorithm decryption must be of type "private"`);
      default:
        break;
    }
  }
  if (key2.type === "private") {
    switch (usage) {
      case "verify":
        throw new TypeError(`${tag(key2)} instances for asymmetric algorithm verifying must be of type "public"`);
      case "encrypt":
        throw new TypeError(`${tag(key2)} instances for asymmetric algorithm encryption must be of type "public"`);
      default:
        break;
    }
  }
};
var check_key_type_default = (alg, key2, usage) => {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A(?:128|192|256)(?:GCM)?(?:KW)?$/.test(alg) || /^A(?:128|192|256)CBC-HS(?:256|384|512)$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key2, usage);
  } else {
    asymmetricTypeCheck(alg, key2, usage);
  }
};

// hosted/node_modules/jose/dist/webapi/lib/subtle_dsa.js
var subtle_dsa_default = (alg, algorithm) => {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: parseInt(alg.slice(-3), 10) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
    case "EdDSA":
      return { name: "Ed25519" };
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return { name: alg };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
};

// hosted/node_modules/jose/dist/webapi/lib/get_sign_verify_key.js
var get_sign_verify_key_default = async (alg, key2, usage) => {
  if (key2 instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key2, "CryptoKey", "KeyObject", "JSON Web Key"));
    }
    return crypto.subtle.importKey("raw", key2, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  checkSigCryptoKey(key2, alg, usage);
  return key2;
};

// hosted/node_modules/jose/dist/webapi/lib/verify.js
var verify_default = async (alg, key2, signature, data) => {
  const cryptoKey = await get_sign_verify_key_default(alg, key2, "verify");
  check_key_length_default(alg, cryptoKey);
  const algorithm = subtle_dsa_default(alg, cryptoKey.algorithm);
  try {
    return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
};

// hosted/node_modules/jose/dist/webapi/jws/flattened/verify.js
async function flattenedVerify(jws, key2, options) {
  if (!is_object_default(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !is_object_default(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!is_disjoint_default(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validate_algorithms_default("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key2 === "function") {
    key2 = await key2(parsedProt, jws);
    resolvedKey = true;
  }
  check_key_type_default(alg, key2, "verify");
  const data = concat(encoder.encode(jws.protected ?? ""), encoder.encode("."), typeof jws.payload === "string" ? encoder.encode(jws.payload) : jws.payload);
  let signature;
  try {
    signature = decode(jws.signature);
  } catch {
    throw new JWSInvalid("Failed to base64url decode the signature");
  }
  const k = await normalize_key_default(key2, alg);
  const verified = await verify_default(alg, k, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    try {
      payload = decode(jws.payload);
    } catch {
      throw new JWSInvalid("Failed to base64url decode the payload");
    }
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key: k };
  }
  return result;
}

// hosted/node_modules/jose/dist/webapi/jws/compact/verify.js
async function compactVerify(jws, key2, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key2, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key2 === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// hosted/node_modules/jose/dist/webapi/lib/epoch.js
var epoch_default = (date) => Math.floor(date.getTime() / 1e3);

// hosted/node_modules/jose/dist/webapi/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = (str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
};

// hosted/node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var normalizeTyp = (value) => {
  if (value.includes("/")) {
    return value.toLowerCase();
  }
  return `application/${value.toLowerCase()}`;
};
var checkAudiencePresence = (audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
};
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!is_object_default(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs_default(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch_default(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs_default(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}

// hosted/node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key2, options) {
  const verified = await compactVerify(jwt, key2, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key2 === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// hosted/node_modules/jose/dist/webapi/jwks/local.js
function getKtyFromAlg(alg) {
  switch (typeof alg === "string" && alg.slice(0, 2)) {
    case "RS":
    case "PS":
      return "RSA";
    case "ES":
      return "EC";
    case "Ed":
      return "OKP";
    case "ML":
      return "AKP";
    default:
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
  }
}
function isJWKSLike(jwks) {
  return jwks && typeof jwks === "object" && Array.isArray(jwks.keys) && jwks.keys.every(isJWKLike);
}
function isJWKLike(key2) {
  return is_object_default(key2);
}
var LocalJWKSet = class {
  #jwks;
  #cached = /* @__PURE__ */ new WeakMap();
  constructor(jwks) {
    if (!isJWKSLike(jwks)) {
      throw new JWKSInvalid("JSON Web Key Set malformed");
    }
    this.#jwks = structuredClone(jwks);
  }
  jwks() {
    return this.#jwks;
  }
  async getKey(protectedHeader, token) {
    const { alg, kid } = { ...protectedHeader, ...token?.header };
    const kty = getKtyFromAlg(alg);
    const candidates = this.#jwks.keys.filter((jwk2) => {
      let candidate = kty === jwk2.kty;
      if (candidate && typeof kid === "string") {
        candidate = kid === jwk2.kid;
      }
      if (candidate && (typeof jwk2.alg === "string" || kty === "AKP")) {
        candidate = alg === jwk2.alg;
      }
      if (candidate && typeof jwk2.use === "string") {
        candidate = jwk2.use === "sig";
      }
      if (candidate && Array.isArray(jwk2.key_ops)) {
        candidate = jwk2.key_ops.includes("verify");
      }
      if (candidate) {
        switch (alg) {
          case "ES256":
            candidate = jwk2.crv === "P-256";
            break;
          case "ES384":
            candidate = jwk2.crv === "P-384";
            break;
          case "ES512":
            candidate = jwk2.crv === "P-521";
            break;
          case "Ed25519":
          case "EdDSA":
            candidate = jwk2.crv === "Ed25519";
            break;
        }
      }
      return candidate;
    });
    const { 0: jwk, length } = candidates;
    if (length === 0) {
      throw new JWKSNoMatchingKey();
    }
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      const _cached = this.#cached;
      error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates) {
          try {
            yield await importWithAlgCache(_cached, jwk2, alg);
          } catch {
          }
        }
      };
      throw error;
    }
    return importWithAlgCache(this.#cached, jwk, alg);
  }
};
async function importWithAlgCache(cache2, jwk, alg) {
  const cached = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk);
  if (cached[alg] === void 0) {
    const key2 = await importJWK({ ...jwk, ext: true }, alg);
    if (key2 instanceof Uint8Array || key2.type !== "public") {
      throw new JWKSInvalid("JSON Web Key Set members must be public keys");
    }
    cached[alg] = key2;
  }
  return cached[alg];
}
function createLocalJWKSet(jwks) {
  const set = new LocalJWKSet(jwks);
  const localJWKSet = async (protectedHeader, token) => set.getKey(protectedHeader, token);
  Object.defineProperties(localJWKSet, {
    jwks: {
      value: () => structuredClone(set.jwks()),
      enumerable: false,
      configurable: false,
      writable: false
    }
  });
  return localJWKSet;
}

// hosted/node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair !== "undefined" || typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers" || typeof EdgeRuntime !== "undefined" && EdgeRuntime === "vercel";
}
var USER_AGENT;
if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "jose";
  const VERSION = "v6.1.0";
  USER_AGENT = `${NAME}/${VERSION}`;
}
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    if (err.name === "TimeoutError") {
      throw new JWKSTimeout();
    }
    throw err;
  });
  if (response.status !== 200) {
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  }
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshJwksCache(input, cacheMaxAge) {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  if (!("uat" in input) || typeof input.uat !== "number" || Date.now() - input.uat >= cacheMaxAge) {
    return false;
  }
  if (!("jwks" in input) || !is_object_default(input.jwks) || !Array.isArray(input.jwks.keys) || !Array.prototype.every.call(input.jwks.keys, is_object_default)) {
    return false;
  }
  return true;
}
var RemoteJWKSet = class {
  #url;
  #timeoutDuration;
  #cooldownDuration;
  #cacheMaxAge;
  #jwksTimestamp;
  #pendingFetch;
  #headers;
  #customFetch;
  #local;
  #cache;
  constructor(url, options) {
    if (!(url instanceof URL)) {
      throw new TypeError("url must be an instance of URL");
    }
    this.#url = new URL(url.href);
    this.#timeoutDuration = typeof options?.timeoutDuration === "number" ? options?.timeoutDuration : 5e3;
    this.#cooldownDuration = typeof options?.cooldownDuration === "number" ? options?.cooldownDuration : 3e4;
    this.#cacheMaxAge = typeof options?.cacheMaxAge === "number" ? options?.cacheMaxAge : 6e5;
    this.#headers = new Headers(options?.headers);
    if (USER_AGENT && !this.#headers.has("User-Agent")) {
      this.#headers.set("User-Agent", USER_AGENT);
    }
    if (!this.#headers.has("accept")) {
      this.#headers.set("accept", "application/json");
      this.#headers.append("accept", "application/jwk-set+json");
    }
    this.#customFetch = options?.[customFetch];
    if (options?.[jwksCache] !== void 0) {
      this.#cache = options?.[jwksCache];
      if (isFreshJwksCache(options?.[jwksCache], this.#cacheMaxAge)) {
        this.#jwksTimestamp = this.#cache.uat;
        this.#local = createLocalJWKSet(this.#cache.jwks);
      }
    }
  }
  pendingFetch() {
    return !!this.#pendingFetch;
  }
  coolingDown() {
    return typeof this.#jwksTimestamp === "number" ? Date.now() < this.#jwksTimestamp + this.#cooldownDuration : false;
  }
  fresh() {
    return typeof this.#jwksTimestamp === "number" ? Date.now() < this.#jwksTimestamp + this.#cacheMaxAge : false;
  }
  jwks() {
    return this.#local?.jwks();
  }
  async getKey(protectedHeader, token) {
    if (!this.#local || !this.fresh()) {
      await this.reload();
    }
    try {
      return await this.#local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey) {
        if (this.coolingDown() === false) {
          await this.reload();
          return this.#local(protectedHeader, token);
        }
      }
      throw err;
    }
  }
  async reload() {
    if (this.#pendingFetch && isCloudflareWorkers()) {
      this.#pendingFetch = void 0;
    }
    this.#pendingFetch ||= fetchJwks(this.#url.href, this.#headers, AbortSignal.timeout(this.#timeoutDuration), this.#customFetch).then((json3) => {
      this.#local = createLocalJWKSet(json3);
      if (this.#cache) {
        this.#cache.uat = Date.now();
        this.#cache.jwks = json3;
      }
      this.#jwksTimestamp = Date.now();
      this.#pendingFetch = void 0;
    }).catch((err) => {
      this.#pendingFetch = void 0;
      throw err;
    });
    await this.#pendingFetch;
  }
};
function createRemoteJWKSet(url, options) {
  const set = new RemoteJWKSet(url, options);
  const remoteJWKSet = async (protectedHeader, token) => set.getKey(protectedHeader, token);
  Object.defineProperties(remoteJWKSet, {
    coolingDown: {
      get: () => set.coolingDown(),
      enumerable: true,
      configurable: false
    },
    fresh: {
      get: () => set.fresh(),
      enumerable: true,
      configurable: false
    },
    reload: {
      value: () => set.reload(),
      enumerable: true,
      configurable: false,
      writable: false
    },
    reloading: {
      get: () => set.pendingFetch(),
      enumerable: true,
      configurable: false
    },
    jwks: {
      value: () => set.jwks(),
      enumerable: true,
      configurable: false,
      writable: false
    }
  });
  return remoteJWKSet;
}

// hosted/src/schedule.ts
var RATING_DAY_OFFSETS = { not_sure: 1, sure: 4 };
function isCardRating(value) {
  return value === "not_sure" || value === "sure";
}
function isValidZone(zone) {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
function localCalendarDate(epochMs, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(epochMs));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year").padStart(4, "0")}-${value("month").padStart(2, "0")}-${value("day").padStart(2, "0")}`;
}
function addCalendarDays(ymd, days) {
  const [year2, month, day2] = ymd.split("-").map(Number);
  if (!year2 || !month || !day2) throw new Error(`Invalid date-only value: ${ymd}`);
  const shifted = new Date(Date.UTC(year2, month - 1, day2 + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
function nextDueDate(rating, todayYmd) {
  return addCalendarDays(todayYmd, RATING_DAY_OFFSETS[rating]);
}

// hosted/src/accounts.ts
var SESSION_SECONDS = 7 * 24 * 60 * 60;
var FLOW_SECONDS = 10 * 60;
var noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
var googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cookie(request, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(request.headers.get("Cookie") ?? "");
  return match?.[1] ?? null;
}
function sessionCookie(value, age = SESSION_SECONDS) {
  return `__Host-wb_session=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}
function csrfCookie(value, age = SESSION_SECONDS) {
  return `__Host-wb_csrf=${value}; Path=/; Max-Age=${age}; Secure; SameSite=Lax`;
}
function flowCookie(value, age = FLOW_SECONDS) {
  return `__Host-wb_oauth=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}
function failure(status, code, message2) {
  return Response.json({ error: { code, message: message2 } }, { status, headers: noStore });
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: noStore });
}
function sameOrigin(request, origin) {
  return request.headers.get("Origin") === origin && new URL(request.url).origin === origin;
}
async function currentSession(request, env) {
  const token = cookie(request, "__Host-wb_session");
  if (!token) return null;
  return env.DB.prepare("SELECT token_hash, csrf_hash, expires_at, account_id FROM learner_sessions WHERE token_hash = ? AND expires_at > ?").bind(await sha256(token), Math.floor(Date.now() / 1e3)).first();
}
async function requireMutation(request, env, session2) {
  if (!env.APP_ORIGIN || !sameOrigin(request, env.APP_ORIGIN))
    return failure(403, "invalid_origin", "Open Whitebook from its official address and try again.");
  const csrf = request.headers.get("X-CSRF-Token");
  if (!csrf || !/^[a-f0-9]{64}$/.test(csrf) || await sha256(csrf) !== session2.csrf_hash)
    return failure(403, "invalid_csrf", "Your session changed. Refresh Whitebook and try again.");
  return null;
}
async function verifyGoogleIdToken(token, clientId, nonce, keys = googleKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"]
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string")
    throw new Error("Invalid Google identity claims");
  return { sub: payload.sub, email: payload.email, name: payload.name };
}
var google = {
  async exchange(code, verifier, env) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "authorization_code",
        redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`
      })
    });
    if (!response.ok) throw new Error("Google code exchange failed");
    const body2 = await response.json();
    if (typeof body2.id_token !== "string") throw new Error("Google did not return an ID token");
    return body2.id_token;
  },
  verify: verifyGoogleIdToken
};
async function start(request, env) {
  if (!env.APP_ORIGIN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || new URL(request.url).origin !== env.APP_ORIGIN)
    return failure(503, "sign_in_unavailable", "Google sign-in is not configured for this address.");
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.DB.prepare("INSERT INTO oauth_flows (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(state), nonce, verifier, Math.floor(Date.now() / 1e3) + FLOW_SECONDS).run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  return new Response(null, { status: 302, headers: { ...noStore, Location: url.toString(), "Set-Cookie": flowCookie(state) } });
}
async function callback(request, env, provider) {
  if (!env.APP_ORIGIN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || new URL(request.url).origin !== env.APP_ORIGIN)
    return failure(503, "sign_in_unavailable", "Google sign-in is not configured for this address.");
  const url = new URL(request.url);
  const state = cookie(request, "__Host-wb_oauth");
  if (!state || state !== url.searchParams.get("state"))
    return failure(403, "invalid_login_state", "Sign-in expired. Start again from Whitebook.");
  const flow = await env.DB.prepare("DELETE FROM oauth_flows WHERE state_hash = ? AND expires_at > ? RETURNING nonce, code_verifier, expires_at").bind(await sha256(state), Math.floor(Date.now() / 1e3)).first();
  if (!flow) return failure(403, "invalid_login_state", "Sign-in expired. Start again from Whitebook.");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || code.length > 2048)
    return new Response(null, { status: 302, headers: { ...noStore, Location: `${env.APP_ORIGIN}/dashboard?error=google_cancelled`, "Set-Cookie": flowCookie("", 0) } });
  let identity;
  try {
    identity = await provider.verify(await provider.exchange(code, flow.code_verifier, env), env.GOOGLE_CLIENT_ID, flow.nonce);
  } catch {
    return new Response(null, { status: 302, headers: { ...noStore, Location: `${env.APP_ORIGIN}/dashboard?error=google_failed`, "Set-Cookie": flowCookie("", 0) } });
  }
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES (?, 'google', ?, ?, ?, ?) ON CONFLICT(provider_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name").bind(crypto.randomUUID(), identity.sub, identity.email, identity.name, now).run();
  const account = await env.DB.prepare("SELECT id, provider_subject, email, display_name, nickname FROM learner_accounts WHERE provider_subject = ?").bind(identity.sub).first();
  if (!account) return failure(503, "account_unavailable", "Your account could not be opened. Try again.");
  const token = randomToken();
  const csrf = randomToken();
  await env.DB.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(await sha256(token), account.id, await sha256(csrf), now + SESSION_SECONDS, now).run();
  const headers = new Headers({ ...noStore, Location: `${env.APP_ORIGIN}/dashboard` });
  headers.append("Set-Cookie", sessionCookie(token));
  headers.append("Set-Cookie", csrfCookie(csrf));
  headers.append("Set-Cookie", flowCookie("", 0));
  return new Response(null, { status: 302, headers });
}
async function me(request, env) {
  const session2 = await currentSession(request, env);
  if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const account = await env.DB.prepare("SELECT id, provider_subject, email, display_name, nickname, time_zone FROM learner_accounts WHERE id = ?").bind(session2.account_id).first();
  if (!account) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  return json({
    account: {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      nickname: account.nickname,
      timeZone: account.time_zone,
      role: env.OWNER_GOOGLE_SUB === account.provider_subject ? "owner" : "learner"
    },
    session: { expiresAt: session2.expires_at }
  });
}
async function mutate(request, env, action) {
  const session2 = await currentSession(request, env);
  if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  if (action === "signout") {
    await env.DB.prepare("DELETE FROM learner_sessions WHERE token_hash = ?").bind(session2.token_hash).run();
    const headers = new Headers({ ...noStore, "Clear-Site-Data": '"cache"' });
    headers.append("Set-Cookie", sessionCookie("", 0));
    headers.append("Set-Cookie", csrfCookie("", 0));
    return new Response(null, { status: 204, headers });
  }
  if (action === "renew") {
    const token = randomToken();
    const csrf = randomToken();
    const expiresAt = Math.floor(Date.now() / 1e3) + SESSION_SECONDS;
    const result = await env.DB.prepare("UPDATE learner_sessions SET token_hash = ?, csrf_hash = ?, expires_at = ? WHERE token_hash = ? AND expires_at > ?").bind(await sha256(token), await sha256(csrf), expiresAt, session2.token_hash, Math.floor(Date.now() / 1e3)).run();
    if (!result.meta.changes) return failure(401, "signed_out", "Your session expired. Sign in again.");
    const headers = new Headers(noStore);
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append("Set-Cookie", csrfCookie(csrf));
    return Response.json({ expiresAt }, { headers });
  }
  let body2;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure(413, "too_large", "That profile update is too large.");
    body2 = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_profile", "Enter a valid nickname.");
  }
  if (!body2 || typeof body2 !== "object" || Array.isArray(body2) || Object.keys(body2).some((key2) => key2 !== "nickname" && key2 !== "timeZone"))
    return failure(400, "invalid_profile", "Only your nickname and time zone can be changed here.");
  let nickname = null;
  let timeZone = null;
  const rawNickname = body2.nickname;
  if (rawNickname !== void 0) {
    if (typeof rawNickname !== "string" || rawNickname.length > 80)
      return failure(400, "invalid_profile", "Nickname must be 80 characters or fewer.");
    nickname = rawNickname.trim();
  }
  const rawZone = body2.timeZone;
  if (rawZone !== void 0) {
    if (typeof rawZone !== "string" || rawZone.length > 64 || rawZone !== "" && !isValidZone(rawZone))
      return failure(400, "invalid_profile", "Enter a valid IANA time zone, or clear it to follow this device.");
    timeZone = rawZone.trim();
  }
  const sets = [
    ...nickname !== null ? ["nickname = ?"] : [],
    ...timeZone !== null ? ["time_zone = ?"] : []
  ];
  if (sets.length) {
    await env.DB.prepare(`UPDATE learner_accounts SET ${sets.join(", ")} WHERE id = ?`).bind(...[
      ...nickname !== null ? [nickname] : [],
      ...timeZone !== null ? [timeZone] : [],
      session2.account_id
    ]).run();
  }
  const stored = await env.DB.prepare("SELECT nickname, time_zone FROM learner_accounts WHERE id = ?").bind(session2.account_id).first();
  return json({ nickname: stored?.nickname ?? "", timeZone: stored?.time_zone ?? "" });
}
function accountRoute(request, env, provider = google) {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/status")
    return Promise.resolve(json({ googleReady: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN === new URL(request.url).origin) }));
  if (request.method === "GET" && path === "/api/auth/google/start") return start(request, env);
  if (request.method === "GET" && path === "/api/auth/google/callback") return callback(request, env, provider);
  if (request.method === "GET" && path === "/api/account/me") return me(request, env);
  if (request.method === "POST" && path === "/api/auth/renew") return mutate(request, env, "renew");
  if (request.method === "POST" && path === "/api/auth/signout") return mutate(request, env, "signout");
  if (request.method === "POST" && path === "/api/account/profile") return mutate(request, env, "profile");
  if (path.startsWith("/api/auth/") || path.startsWith("/api/account/"))
    return Promise.resolve(failure(404, "not_found", "This account action is unavailable."));
  return null;
}

// hosted/src/accountData.ts
var owned = [
  { name: "privateRevisionEntitlements", table: "private_revision_entitlements", fields: "revision_id", order: "revision_id" },
  { name: "satDates", table: "learner_sat_dates", fields: "test_date, is_primary, selected_at", order: "test_date" },
  { name: "officialSatResults", table: "official_sat_results", fields: "id, administration_date, total_score, reading_writing_score, math_score, band_information_ideas, band_craft_structure, band_expression_of_ideas, band_standard_english_conventions, band_algebra, band_advanced_math, band_problem_solving_data_analysis, band_geometry_trigonometry, created_at, updated_at", order: "administration_date, id" },
  { name: "personalCards", table: "personal_cards", fields: "id, deck, front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at", order: "created_at, id" },
  { name: "cardRatings", table: "card_rating_events", fields: "id, card_id, rating, rating_zone, next_due, rated_at", order: "rated_at, id" },
  { name: "starterCardRatings", table: "starter_card_rating_events", fields: "id, deck_id, stable_id, rating, rating_zone, next_due, rated_at", order: "rated_at, id" },
  { name: "attempts", table: "learner_attempts", fields: "id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, completed_at_ms, result_json, answers_exposed_at_ms, assisted_at_ms", order: "created_at_ms, id" },
  { name: "guidedReviews", table: "guided_reviews", fields: "id, attempt_id, revision_id, question_id, prior_answer_exposure, retry_response, hint_used, revealed_at_ms, mistake_label, created_at_ms, updated_at_ms", order: "created_at_ms, id" },
  { name: "studyNotes", table: "study_notes", fields: "id, revision_id, question_id, body, created_at_ms, updated_at_ms", order: "created_at_ms, id" },
  { name: "planVersions", table: "study_plan_versions", fields: "id, version, primary_date, settings_json, source_json, created_at_ms", order: "version" },
  { name: "planTasks", table: "study_plan_tasks", fields: "id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, updated_at_ms", order: "scheduled_date, id" },
  { name: "planTaskEvents", table: "study_plan_task_events", fields: "id, version_id, task_id, event_json, created_at_ms", order: "created_at_ms, id" },
  { name: "reminderDismissals", table: "reminder_dismissals", fields: "reminder_key, dismissed_at_ms", order: "reminder_key" }
];
var jsonNames = {
  config_json: "config",
  questions_json: "questions",
  state_json: "state",
  result_json: "result",
  settings_json: "settings",
  source_json: "source",
  action_json: "action",
  event_json: "event"
};
function portable(row) {
  const result = {};
  for (const [key2, value] of Object.entries(row))
    result[jsonNames[key2] ?? key2] = key2 in jsonNames && value !== null ? JSON.parse(value) : value;
  return result;
}
async function exportAccount(env, session2) {
  const account = await env.DB.prepare("SELECT id, provider, provider_subject, email, display_name, nickname, time_zone, created_at FROM learner_accounts WHERE id = ?").bind(session2.account_id).first();
  if (!account) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const data = {};
  for (const item of owned) {
    const result = await env.DB.prepare(`SELECT ${item.fields} FROM ${item.table} WHERE account_id = ? ORDER BY ${item.order}`).bind(session2.account_id).all();
    data[item.name] = result.results.map(portable);
  }
  return Response.json({
    format: "whitebook-account-export",
    schemaVersion: 1,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    account,
    data
  }, {
    headers: { ...noStore, "Content-Disposition": 'attachment; filename="whitebook-account-export.json"' }
  });
}
async function deleteAccount(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json"))
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
  let body2;
  try {
    const raw = await request.text();
    if (raw.length > 128) return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
    body2 = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
  }
  if (!body2 || typeof body2 !== "object" || Array.isArray(body2) || Object.keys(body2).length !== 1 || body2.confirmation !== "DELETE MY ACCOUNT")
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
  const order = [
    "study_plan_task_events",
    "study_plan_tasks",
    "study_plan_versions",
    "study_notes",
    "guided_reviews",
    "card_rating_events",
    "starter_card_rating_events",
    "personal_cards",
    "learner_attempts",
    "official_sat_results",
    "learner_sat_dates",
    "reminder_dismissals",
    "private_revision_entitlements",
    "learner_sessions"
  ];
  await env.DB.batch([
    env.DB.prepare("DELETE FROM assistant_limits WHERE scope IN (?, ?)").bind(`preview:${session2.account_id}`, `send:${session2.account_id}`),
    ...order.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE account_id = ?`).bind(session2.account_id)),
    env.DB.prepare("DELETE FROM learner_accounts WHERE id = ?").bind(session2.account_id)
  ]);
  const headers = new Headers({ ...noStore, "Clear-Site-Data": '"cache"' });
  headers.append("Set-Cookie", "__Host-wb_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "__Host-wb_csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax");
  return new Response(null, { status: 204, headers });
}
function accountDataRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== "/api/account/export" && path !== "/api/account/delete") return null;
  if (!(request.method === "GET" && path === "/api/account/export") && !(request.method === "POST" && path === "/api/account/delete"))
    return Promise.resolve(failure(405, "method_not_allowed", "This account action is unavailable."));
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    return path === "/api/account/export" ? exportAccount(env, session2) : deleteAccount(request, env, session2);
  })();
}

// hosted/src/reminders.ts
var reminders = {
  primary_sat_date: {
    key: "primary_sat_date",
    title: "Choose your SAT date",
    description: "Choose a primary SAT Weekend to anchor your Study Plan and dashboard countdown.",
    action: "choose_sat_date"
  },
  personal_gemini_key: {
    key: "personal_gemini_key",
    title: "Personal Gemini key is optional",
    description: "When Personal Gemini is available, you can add your key in Tutor Chat. Your regular study tools do not need it.",
    action: null
  }
};
async function list(env, accountId) {
  const primary = await env.DB.prepare("SELECT 1 FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1 LIMIT 1").bind(accountId).first();
  const credential2 = await env.DB.prepare("SELECT 1 FROM assistant_credentials WHERE account_id = ? LIMIT 1").bind(accountId).first();
  const dismissalRows = await env.DB.prepare("SELECT reminder_key FROM reminder_dismissals WHERE account_id = ?").bind(accountId).all();
  const dismissed = new Set(dismissalRows.results.map((row) => row.reminder_key));
  const active = [!primary && reminders.primary_sat_date, !credential2 && reminders.personal_gemini_key].filter((item) => !!item && !dismissed.has(item.key));
  return Response.json({ reminders: active }, { headers: noStore });
}
async function dismiss(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json"))
    return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
  let body2;
  try {
    const raw = await request.text();
    if (raw.length > 128) return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
    body2 = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
  }
  if (!body2 || typeof body2 !== "object" || Array.isArray(body2) || Object.keys(body2).length !== 1 || !("key" in body2) || typeof body2.key !== "string" || !(body2.key in reminders))
    return failure(400, "invalid_reminder", "Choose a reminder to dismiss.");
  await env.DB.prepare("INSERT INTO reminder_dismissals (account_id, reminder_key, dismissed_at_ms) VALUES (?, ?, ?) ON CONFLICT(account_id, reminder_key) DO NOTHING").bind(session2.account_id, body2.key, Date.now()).run();
  return new Response(null, { status: 204, headers: noStore });
}
function remindersRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== "/api/reminders" && path !== "/api/reminders/dismiss") return null;
  if (!(request.method === "GET" && path === "/api/reminders") && !(request.method === "POST" && path === "/api/reminders/dismiss"))
    return Promise.resolve(failure(405, "method_not_allowed", "This reminder action is unavailable."));
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to see your reminders.");
    return path === "/api/reminders" ? list(env, session2.account_id) : dismiss(request, env, session2);
  })();
}

// hosted/src/satDates.ts
var SAT_CATALOG = {
  source: "College Board SAT test dates and deadlines",
  sourceUrl: "https://satsuite.collegeboard.org/sat/dates-deadlines",
  lastCheckedAt: "2026-09-26",
  dates: [
    { date: "2026-10-03", status: "confirmed" },
    { date: "2026-11-07", status: "confirmed" },
    { date: "2026-12-05", status: "confirmed" },
    { date: "2027-03-06", status: "confirmed" },
    { date: "2027-05-01", status: "confirmed" },
    { date: "2027-06-05", status: "confirmed" },
    { date: "2027-08-28", status: "anticipated" },
    { date: "2027-09-18", status: "anticipated" },
    { date: "2027-10-02", status: "anticipated" },
    { date: "2027-11-06", status: "anticipated" },
    { date: "2027-12-04", status: "anticipated" },
    { date: "2028-03-04", status: "anticipated" },
    { date: "2028-05-06", status: "anticipated" },
    { date: "2028-06-03", status: "anticipated" }
  ]
};
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function catalogDates() {
  return new Set(SAT_CATALOG.dates.map((entry) => entry.date));
}
function readSelection(rows3) {
  const dates = rows3.map((row) => row.test_date).sort();
  const primary = rows3.find((row) => row.is_primary === 1);
  return { dates, primary: primary?.test_date ?? null };
}
async function replaceSelection(env, accountId, dates, primary) {
  const now = Math.floor(Date.now() / 1e3);
  const statements = [env.DB.prepare("DELETE FROM learner_sat_dates WHERE account_id = ?").bind(accountId)];
  for (const date of dates)
    statements.push(env.DB.prepare("INSERT INTO learner_sat_dates (account_id, test_date, is_primary, selected_at) VALUES (?, ?, ?, ?)").bind(accountId, date, date === primary ? 1 : 0, now));
  await env.DB.batch(statements);
}
async function show(request, env) {
  const session2 = await currentSession(request, env);
  if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const rows3 = await env.DB.prepare("SELECT test_date, is_primary FROM learner_sat_dates WHERE account_id = ? ORDER BY test_date").bind(session2.account_id).all();
  return Response.json(
    {
      catalog: SAT_CATALOG,
      selection: readSelection(rows3.results)
    },
    { headers: noStore }
  );
}
async function save(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  let body2;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure(413, "too_large", "That SAT date selection is too large.");
    body2 = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_sat_dates", "Choose your SAT dates and try again.");
  }
  if (!body2 || typeof body2 !== "object" || Array.isArray(body2) || Object.keys(body2).some((key2) => key2 !== "dates" && key2 !== "primary"))
    return failure(400, "invalid_sat_dates", "Only SAT dates and the primary target can be saved here.");
  const { dates, primary } = body2;
  const allowed = catalogDates();
  if (!Array.isArray(dates) || dates.length > SAT_CATALOG.dates.length || dates.some((date) => typeof date !== "string" || !DATE_PATTERN.test(date) || !allowed.has(date)) || new Set(dates).size !== dates.length)
    return failure(400, "invalid_sat_dates", "Choose SAT Weekend dates from the official list.");
  if (typeof primary !== "string" && primary !== null)
    return failure(400, "invalid_sat_dates", "Your primary SAT date must be one of your selected dates.");
  if (dates.length === 0 && primary !== null || dates.length > 0 && (primary === null || !dates.includes(primary)))
    return failure(400, "invalid_sat_dates", "Your primary SAT date must be one of your selected dates.");
  await replaceSelection(env, session2.account_id, [...dates].sort(), primary);
  return Response.json(
    { selection: { dates: [...dates].sort(), primary } },
    { headers: noStore }
  );
}
function satDateRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/account/sat-dates") return show(request, env);
  if (request.method === "POST" && path === "/api/account/sat-dates")
    return currentSession(request, env).then((session2) => session2 ? save(request, env, session2) : failure(401, "signed_out", "Sign in with Google to open your workspace."));
  return null;
}

// hosted/src/cards.ts
var BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"];
var BACK_COLUMNS = {
  definition: "definition",
  vietnamese: "vietnamese",
  partOfSpeech: "part_of_speech",
  pronunciation: "pronunciation",
  synonyms: "synonyms",
  example: "example"
};
var CARD_COLUMNS = "id, deck, front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at";
var FRONT_MAX = 240;
var BACK_MAX = 2e3;
var DECK_MAX = 80;
var BODY_MAX = 16384;
var DEFAULT_DECK = "My words";
var BATCH_MAX = 20;
var normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
function cardJson(row) {
  const card = {
    id: row.id,
    deck: row.deck,
    front: row.front,
    archived: row.archived_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  for (const field of BACK_FIELDS) {
    const value = row[BACK_COLUMNS[field]];
    if (value) card[field] = value;
  }
  return card;
}
function duplicateJson(row) {
  const match = { id: row.id, deck: row.deck, front: row.front, archived: row.archived_at !== null };
  if (row.definition) match.definition = row.definition;
  if (row.vietnamese) match.vietnamese = row.vietnamese;
  return match;
}
function fieldErrorsFor(front, back) {
  const errors = {};
  if (!front) errors.front = "Add the word or phrase for the front of the card.";
  else if (front.length > FRONT_MAX) errors.front = `Keep the front at ${FRONT_MAX} characters or fewer.`;
  if (!BACK_FIELDS.some((field) => back[field])) errors.back = "Add at least one back field, such as a definition or Vietnamese meaning.";
  for (const field of BACK_FIELDS)
    if (back[field].length > BACK_MAX) errors[field] = "Keep this field at 2,000 characters or fewer.";
  return Object.keys(errors).length ? errors : null;
}
function validationError(fieldErrors) {
  return Response.json(
    { error: { code: "validation", message: "Check the highlighted card fields.", fieldErrors } },
    { status: 400, headers: noStore }
  );
}
function duplicateGate(duplicate) {
  return Response.json(
    {
      error: {
        code: "duplicate_possible",
        message: `\u201C${duplicate.front}\u201D already looks like a card in \u201C${duplicate.deck}\u201D. Check it before saving so different senses stay separate, or save anyway to keep both.`,
        duplicateOf: duplicateJson(duplicate)
      }
    },
    { status: 409, headers: noStore }
  );
}
async function parseBody(request) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return { response: failure(400, "invalid_card", "Send the card as JSON.") };
  }
  if (raw.length > BODY_MAX) return { response: failure(413, "too_large", "That card is too large.") };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { body: parsed };
  } catch {
    return { response: failure(400, "invalid_card", "Send the card as JSON.") };
  }
}
function stringField(body2, key2) {
  const value = body2[key2];
  if (value === void 0) return { present: false, value: "", invalid: false };
  if (typeof value !== "string") return { present: true, value: "", invalid: true };
  return { present: true, value: value.trim(), invalid: false };
}
async function findDuplicate(env, accountId, deck, front, excludeId) {
  const sql = `SELECT id, deck, front, definition, vietnamese, archived_at FROM personal_cards
    WHERE account_id = ? AND deck_key = ? AND front_key = ?${excludeId ? " AND id <> ?" : ""}
    ORDER BY archived_at IS NOT NULL, created_at LIMIT 1`;
  const args = [accountId, normalize(deck), normalize(front)];
  if (excludeId) args.push(excludeId);
  return env.DB.prepare(sql).bind(...args).first();
}
async function ownedCard(env, accountId, id) {
  return env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE id = ? AND account_id = ?`).bind(id, accountId).first();
}
async function list2(request, env, session2) {
  const url = new URL(request.url);
  const archived = url.searchParams.get("archived") === "1";
  const deck = url.searchParams.get("deck");
  const cards = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS} FROM personal_cards WHERE account_id = ? AND archived_at IS ${archived ? "NOT" : ""} NULL${deck ? " AND deck_key = ?" : ""} ORDER BY updated_at DESC`
  ).bind(...deck ? [session2.account_id, normalize(deck)] : [session2.account_id]).all();
  const decks = await env.DB.prepare(
    "SELECT DISTINCT deck FROM personal_cards WHERE account_id = ? ORDER BY deck"
  ).bind(session2.account_id).all();
  return json({ decks: decks.results.map((row) => row.deck), cards: cards.results.map((row) => cardJson(row)) });
}
async function duplicates(request, env, session2) {
  const url = new URL(request.url);
  const front = (url.searchParams.get("front") ?? "").trim();
  const deck = (url.searchParams.get("deck") ?? "").trim();
  const exclude = (url.searchParams.get("exclude") ?? "").trim();
  if (!front || front.length > FRONT_MAX || !deck || deck.length > DECK_MAX)
    return failure(400, "invalid_request", "Provide the card front and deck to check for duplicates.");
  const matches = await env.DB.prepare(
    `SELECT id, deck, front, definition, vietnamese, archived_at FROM personal_cards
     WHERE account_id = ? AND deck_key = ? AND front_key = ?${exclude ? " AND id <> ?" : ""}
     ORDER BY archived_at IS NOT NULL, created_at LIMIT 5`
  ).bind(...exclude ? [session2.account_id, normalize(deck), normalize(front), exclude] : [session2.account_id, normalize(deck), normalize(front)]).all();
  return json({ matches: matches.results.map((row) => duplicateJson(row)) });
}
async function show2(env, session2, id) {
  const row = await ownedCard(env, session2.account_id, id);
  return row ? json({ card: cardJson(row) }) : failure(404, "not_found", "This card is unavailable.");
}
async function create(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body2 = parsed.body;
  if (Object.keys(body2).some((key2) => key2 !== "confirm" && key2 !== "deck" && key2 !== "front" && !BACK_FIELDS.includes(key2)))
    return failure(400, "invalid_card", "Only card fields can be saved here.");
  const deckField = stringField(body2, "deck");
  const frontField = stringField(body2, "front");
  const back = {};
  const errors = {};
  if (deckField.invalid || deckField.value.length > DECK_MAX)
    errors.deck = deckField.invalid ? "The deck name must be text." : `Keep the deck name at ${DECK_MAX} characters or fewer.`;
  for (const field of BACK_FIELDS) {
    const value = stringField(body2, field);
    if (value.invalid) errors[field] = "This field must be text.";
    else back[field] = value.value;
  }
  const fieldErrors = fieldErrorsFor(frontField.value, back);
  const allErrors = { ...errors, ...fieldErrors };
  if (Object.keys(allErrors).length) return validationError(allErrors);
  const deck = deckField.value || DEFAULT_DECK;
  const duplicate = await findDuplicate(env, session2.account_id, deck, frontField.value);
  if (duplicate && body2.confirm !== true) return duplicateGate(duplicate);
  const now = Math.floor(Date.now() / 1e3);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).bind(
    id,
    session2.account_id,
    deck,
    normalize(deck),
    frontField.value,
    normalize(frontField.value),
    back.definition,
    back.vietnamese,
    back.partOfSpeech,
    back.pronunciation,
    back.synonyms,
    back.example,
    now,
    now
  ).run();
  const row = await ownedCard(env, session2.account_id, id);
  return row ? json({ card: cardJson(row) }, 201) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}
async function saveBatch(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body2 = parsed.body;
  if (Object.keys(body2).some((key2) => key2 !== "cards")) return failure(400, "invalid_batch", "Only the reviewed card batch can be saved.");
  if (!Array.isArray(body2.cards) || body2.cards.length === 0 || body2.cards.length > BATCH_MAX)
    return failure(400, "invalid_batch", `Save between 1 and ${BATCH_MAX} reviewed cards.`);
  const errors = {};
  const normalizedCards = [];
  const seen = /* @__PURE__ */ new Map();
  for (const [index, raw] of body2.cards.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors[String(index)] = { card: "This draft is invalid." };
      continue;
    }
    const item = raw;
    const values = {};
    const fieldErrors = {};
    const front = typeof item.front === "string" ? item.front.trim() : "";
    const deck = item.deck === void 0 ? DEFAULT_DECK : typeof item.deck === "string" ? item.deck.trim() : "";
    if (!deck || deck.length > DECK_MAX) fieldErrors.deck = deck ? `Keep the deck name at ${DECK_MAX} characters or fewer.` : "Name the destination deck.";
    if (front.length > FRONT_MAX) fieldErrors.front = `Keep the front at ${FRONT_MAX} characters or fewer.`;
    for (const field of BACK_FIELDS) {
      const value = item[field];
      if (value !== void 0 && typeof value !== "string") fieldErrors[field] = "This field must be text.";
      values[field] = typeof value === "string" ? value.trim() : "";
      if (values[field].length > BACK_MAX) fieldErrors[field] = "Keep this field at 2,000 characters or fewer.";
    }
    if (!front) fieldErrors.front = "Add the word or phrase for the front of the card.";
    if (!BACK_FIELDS.some((field) => values[field])) fieldErrors.back = "Add at least one back field.";
    if (Object.keys(fieldErrors).length) {
      errors[String(index)] = fieldErrors;
      continue;
    }
    const key2 = `${normalize(deck)}\0${normalize(front)}`;
    const prior = seen.get(key2);
    if (prior !== void 0) {
      errors[String(index)] = { duplicate: `This draft duplicates draft ${prior + 1}.` };
      continue;
    }
    seen.set(key2, index);
    normalizedCards.push({ deck, front, back: values });
  }
  if (Object.keys(errors).length) return Response.json({ error: { code: "batch_invalid", message: "Review the card drafts before saving.", fieldErrors: errors } }, { status: 400, headers: noStore });
  const duplicates2 = {};
  for (const [index, card] of normalizedCards.entries()) {
    const duplicate = await findDuplicate(env, session2.account_id, card.deck, card.front);
    if (duplicate) duplicates2[String(index)] = duplicateJson(duplicate);
  }
  if (Object.keys(duplicates2).length) return Response.json({ error: { code: "batch_duplicates", message: "Resolve duplicate cards before saving the batch.", duplicates: duplicates2 } }, { status: 409, headers: noStore });
  const now = Math.floor(Date.now() / 1e3);
  const ids = normalizedCards.map(() => crypto.randomUUID());
  const statements = normalizedCards.map((card, index) => {
    const id = ids[index];
    return env.DB.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).bind(id, session2.account_id, card.deck, normalize(card.deck), card.front, normalize(card.front), card.back.definition, card.back.vietnamese, card.back.partOfSpeech, card.back.pronunciation, card.back.synonyms, card.back.example, now, now);
  });
  try {
    await env.DB.batch(statements);
  } catch {
    return failure(503, "batch_failed", "The card batch was not saved. Your reviewed drafts are unchanged.");
  }
  const inserted = await env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE account_id = ? AND id IN (${ids.map(() => "?").join(", ")})`).bind(session2.account_id, ...ids).all();
  const byId = new Map(inserted.results.map((row) => [row.id, row]));
  if (ids.some((id) => !byId.has(id))) return failure(503, "batch_unavailable", "The saved card batch could not be opened. Refresh your cards to check the result.");
  return json({ cards: ids.map((id) => cardJson(byId.get(id))) }, 201);
}
async function edit(request, env, session2, id) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const row = await ownedCard(env, session2.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body2 = parsed.body;
  if (Object.keys(body2).some((key2) => key2 !== "front" && !BACK_FIELDS.includes(key2)))
    return failure(400, "invalid_card", "Only card fields can be changed here. Use move for the deck.");
  const frontField = stringField(body2, "front");
  const back = { definition: row.definition, vietnamese: row.vietnamese, partOfSpeech: row.part_of_speech, pronunciation: row.pronunciation, synonyms: row.synonyms, example: row.example };
  const errors = {};
  for (const field of BACK_FIELDS) {
    const value = stringField(body2, field);
    if (value.invalid) errors[field] = "This field must be text.";
    else if (value.present) back[field] = value.value;
  }
  const fieldErrors = fieldErrorsFor(frontField.present ? frontField.value : row.front, back);
  const allErrors = { ...errors, ...fieldErrors };
  if (Object.keys(allErrors).length) return validationError(allErrors);
  const updates = [];
  const args = [];
  if (frontField.present) {
    updates.push("front = ?", "front_key = ?");
    args.push(frontField.value, normalize(frontField.value));
  }
  for (const field of BACK_FIELDS)
    if (body2[field] !== void 0) {
      updates.push(`${String(BACK_COLUMNS[field])} = ?`);
      args.push(back[field]);
    }
  updates.push("updated_at = ?");
  args.push(Math.floor(Date.now() / 1e3));
  await env.DB.prepare(`UPDATE personal_cards SET ${updates.join(", ")} WHERE id = ? AND account_id = ?`).bind(...args, id, session2.account_id).run();
  const updated = await ownedCard(env, session2.account_id, id);
  return updated ? json({ card: cardJson(updated) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}
async function move(request, env, session2, id) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const row = await ownedCard(env, session2.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body2 = parsed.body;
  if (Object.keys(body2).some((key2) => key2 !== "deck" && key2 !== "confirm"))
    return failure(400, "invalid_card", "Only the deck can be changed here.");
  const deckField = stringField(body2, "deck");
  if (deckField.invalid || !deckField.value || deckField.value.length > DECK_MAX)
    return validationError({ deck: deckField.invalid ? "The deck name must be text." : deckField.value ? `Keep the deck name at ${DECK_MAX} characters or fewer.` : "Name the deck to move the card into." });
  const duplicate = await findDuplicate(env, session2.account_id, deckField.value, row.front, id);
  if (duplicate && body2.confirm !== true) return duplicateGate(duplicate);
  await env.DB.prepare("UPDATE personal_cards SET deck = ?, deck_key = ?, updated_at = ? WHERE id = ? AND account_id = ?").bind(deckField.value, normalize(deckField.value), Math.floor(Date.now() / 1e3), id, session2.account_id).run();
  const moved = await ownedCard(env, session2.account_id, id);
  return moved ? json({ card: cardJson(moved) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}
async function setArchived(request, env, session2, id, archived) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const row = await ownedCard(env, session2.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  if (row.archived_at !== null !== archived) {
    await env.DB.prepare(`UPDATE personal_cards SET archived_at = ?, updated_at = ? WHERE id = ? AND account_id = ?`).bind(archived ? Math.floor(Date.now() / 1e3) : null, Math.floor(Date.now() / 1e3), id, session2.account_id).run();
  }
  const updated = await ownedCard(env, session2.account_id, id);
  return updated ? json({ card: cardJson(updated) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}
function cardRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cards")) return null;
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method === "GET" && path === "/api/cards") return list2(request, env, session2);
    if (request.method === "GET" && path === "/api/cards/duplicates") return duplicates(request, env, session2);
    if (request.method === "POST" && path === "/api/cards/batch") return saveBatch(request, env, session2);
    if (request.method === "POST" && path === "/api/cards") return create(request, env, session2);
    const single = /^\/api\/cards\/([A-Za-z0-9-]+)$/.exec(path);
    if (request.method === "GET" && single) return show2(env, session2, single[1]);
    if (request.method === "PATCH" && single) return edit(request, env, session2, single[1]);
    const action = /^\/api\/cards\/([A-Za-z0-9-]+)\/(move|archive|restore)$/.exec(path);
    if (request.method === "POST" && action)
      return action[2] === "move" ? move(request, env, session2, action[1]) : setArchived(request, env, session2, action[1], action[2] === "archive");
    return failure(404, "not_found", "This card action is unavailable.");
  })();
}

// hosted/src/scores.ts
var READING_WRITING_DOMAINS = [
  "informationIdeas",
  "craftStructure",
  "expressionOfIdeas",
  "standardEnglishConventions"
];
var MATH_DOMAINS = [
  "algebra",
  "advancedMath",
  "problemSolvingDataAnalysis",
  "geometryTrigonometry"
];
var BAND_KEYS = [...READING_WRITING_DOMAINS, ...MATH_DOMAINS];
var BAND_COLUMNS = {
  informationIdeas: "band_information_ideas",
  craftStructure: "band_craft_structure",
  expressionOfIdeas: "band_expression_of_ideas",
  standardEnglishConventions: "band_standard_english_conventions",
  algebra: "band_algebra",
  advancedMath: "band_advanced_math",
  problemSolvingDataAnalysis: "band_problem_solving_data_analysis",
  geometryTrigonometry: "band_geometry_trigonometry"
};
function sectionScore(value, low, high) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high || value % 10 !== 0)
    return null;
  return value;
}
function isCalendarDate(value) {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function parseBands(value) {
  const source = value === void 0 ? {} : value;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const bands = Object.fromEntries(BAND_KEYS.map((key2) => [key2, null]));
  for (const [key2, raw] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(bands, key2)) return null;
    if (raw === null) continue;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 7) return null;
    bands[key2] = raw;
  }
  return bands;
}
function parseResult(body2) {
  if (!body2 || typeof body2 !== "object" || Array.isArray(body2))
    return { ok: false, response: failure(400, "invalid_result", "Enter the test date, Section scores, and total score.") };
  const input = body2;
  const unexpected = Object.keys(input).some((key2) => !["administrationDate", "readingWriting", "math", "total", "bands"].includes(key2));
  if (unexpected)
    return { ok: false, response: failure(400, "invalid_result", "Only the test date, Section scores, total score, and bands can be saved.") };
  const date = input.administrationDate;
  if (typeof date !== "string" || !isCalendarDate(date))
    return { ok: false, response: failure(400, "invalid_date", "Enter the real calendar date you took the SAT.") };
  if (date > today())
    return { ok: false, response: failure(400, "invalid_date", "Official results cannot be dated in the future.") };
  const readingWriting = sectionScore(input.readingWriting, 200, 800);
  if (readingWriting === null)
    return { ok: false, response: failure(400, "invalid_section", "Reading and Writing scores run from 200 to 800 in 10-point increments.") };
  const math = sectionScore(input.math, 200, 800);
  if (math === null)
    return { ok: false, response: failure(400, "invalid_section", "Math scores run from 200 to 800 in 10-point increments.") };
  const total = sectionScore(input.total, 400, 1600);
  if (total === null)
    return { ok: false, response: failure(400, "invalid_total", "Total scores run from 400 to 1600 in 10-point increments.") };
  if (total !== readingWriting + math)
    return { ok: false, response: failure(400, "invalid_total", "The total must equal Reading and Writing plus Math.") };
  const bands = parseBands(input.bands);
  if (!bands)
    return { ok: false, response: failure(400, "invalid_band", "Each band is one position from 1 to 7, or leave it as Not provided.") };
  return { ok: true, value: { administration_date: date, total_score: total, reading_writing_score: readingWriting, math_score: math, bands } };
}
function rowJson(row) {
  const bands = Object.fromEntries(
    BAND_KEYS.map((key2) => [key2, row[BAND_COLUMNS[key2]]])
  );
  return {
    id: row.id,
    administrationDate: row.administration_date,
    total: row.total_score,
    readingWriting: row.reading_writing_score,
    math: row.math_score,
    bands,
    enteredBy: "learner",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var RESULT_COLUMNS = `id, account_id, administration_date, total_score, reading_writing_score, math_score, ${BAND_KEYS.map((key2) => BAND_COLUMNS[key2]).join(", ")}, created_at, updated_at`;
async function readBody(request) {
  const raw = await request.text();
  if (raw.length > 4096) return { ok: false, response: failure(413, "too_large", "That score entry is too large.") };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: failure(400, "invalid_result", "Enter the test date, Section scores, and total score.") };
  }
}
async function listResults(env, session2) {
  const result = await env.DB.prepare(
    `SELECT ${RESULT_COLUMNS} FROM official_sat_results WHERE account_id = ? ORDER BY administration_date DESC, created_at DESC`
  ).bind(session2.account_id).all();
  return json({ results: result.results.map(rowJson) });
}
async function createResult(request, env, session2) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const body2 = await readBody(request);
  if (!body2.ok) return body2.response;
  const parsed = parseResult(body2.value);
  if (!parsed.ok) return parsed.response;
  const now = Math.floor(Date.now() / 1e3);
  const id = crypto.randomUUID();
  const bands = parsed.value.bands;
  await env.DB.prepare(
    `INSERT INTO official_sat_results (id, account_id, administration_date, total_score, reading_writing_score, math_score, ${BAND_KEYS.map((key2) => BAND_COLUMNS[key2]).join(", ")}, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ${BAND_KEYS.map(() => "?").join(", ")}, ?, ?)`
  ).bind(
    id,
    session2.account_id,
    parsed.value.administration_date,
    parsed.value.total_score,
    parsed.value.reading_writing_score,
    parsed.value.math_score,
    ...BAND_KEYS.map((key2) => bands[key2]),
    now,
    now
  ).run();
  return json({
    id,
    administrationDate: parsed.value.administration_date,
    total: parsed.value.total_score,
    readingWriting: parsed.value.reading_writing_score,
    math: parsed.value.math_score,
    bands,
    enteredBy: "learner",
    createdAt: now,
    updatedAt: now
  }, 201);
}
async function getResult(env, session2, id) {
  const row = await env.DB.prepare(
    `SELECT ${RESULT_COLUMNS} FROM official_sat_results WHERE id = ? AND account_id = ?`
  ).bind(id, session2.account_id).first();
  return row ? json(rowJson(row)) : failure(404, "not_found", "That score entry does not exist.");
}
async function updateResult(request, env, session2, id) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const body2 = await readBody(request);
  if (!body2.ok) return body2.response;
  const parsed = parseResult(body2.value);
  if (!parsed.ok) return parsed.response;
  const now = Math.floor(Date.now() / 1e3);
  const bands = parsed.value.bands;
  const result = await env.DB.prepare(
    `UPDATE official_sat_results SET administration_date = ?, total_score = ?, reading_writing_score = ?, math_score = ?, ${BAND_KEYS.map((key2) => `${BAND_COLUMNS[key2]} = ?`).join(", ")}, updated_at = ?
     WHERE id = ? AND account_id = ?`
  ).bind(
    parsed.value.administration_date,
    parsed.value.total_score,
    parsed.value.reading_writing_score,
    parsed.value.math_score,
    ...BAND_KEYS.map((key2) => bands[key2]),
    now,
    id,
    session2.account_id
  ).run();
  if (!result.meta.changes) return failure(404, "not_found", "That score entry does not exist.");
  return getResult(env, session2, id);
}
async function deleteResult(request, env, session2, id) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const result = await env.DB.prepare("DELETE FROM official_sat_results WHERE id = ? AND account_id = ?").bind(id, session2.account_id).run();
  if (!result.meta.changes) return failure(404, "not_found", "That score entry does not exist.");
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
var SCORE_ID = /^\/api\/account\/scores\/([A-Za-z0-9-]+)$/;
var SCORE_COLLECTION = /^\/api\/account\/scores$/;
function scoresRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (SCORE_COLLECTION.test(path))
    return request.method === "GET" ? listRoute(request, env) : request.method === "POST" ? createRoute(request, env) : Promise.resolve(notMatched());
  const match = SCORE_ID.exec(path);
  if (!match) return null;
  const id = match[1];
  if (request.method === "GET") return guarded(request, env, (session2) => getResult(env, session2, id));
  if (request.method === "PUT") return guarded(request, env, (session2) => updateResult(request, env, session2, id));
  if (request.method === "DELETE") return guarded(request, env, (session2) => deleteResult(request, env, session2, id));
  return Promise.resolve(notMatched());
}
function notMatched() {
  return failure(404, "not_found", "This score action is unavailable.");
}
async function listRoute(request, env) {
  const session2 = await currentSession(request, env);
  return session2 ? listResults(env, session2) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}
async function createRoute(request, env) {
  const session2 = await currentSession(request, env);
  return session2 ? createResult(request, env, session2) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}
async function guarded(request, env, action) {
  const session2 = await currentSession(request, env);
  return session2 ? action(session2) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}

// hosted/src/study.ts
var BODY_MAX2 = 4096;
var REQUEST_ID_MAX = 100;
var CARD_ID_MAX = 64;
var PAGE_DEFAULT = 25;
var PAGE_MAX = 50;
var normalize2 = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
async function sha2562(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function effectiveZone(env, accountId, suppliedZone) {
  const row = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(accountId).first();
  const saved = row?.time_zone?.trim();
  if (saved && isValidZone(saved)) return { zone: saved, source: "account" };
  if (saved) return { zone: "UTC", source: "default" };
  if (suppliedZone !== null) {
    if (!isValidZone(suppliedZone))
      return failure(400, "invalid_zone", "That time zone is not a valid IANA name.");
    return { zone: suppliedZone, source: "device" };
  }
  return { zone: "UTC", source: "default" };
}
function parseDeckFilter(raw) {
  if (!raw || raw === "all") return {};
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":").trim();
  if (kind === "personal" && value) {
    if (value.length > 80) return failure(400, "invalid_request", "That deck filter is too long.");
    return { personalDeckKey: normalize2(value) };
  }
  if (kind === "starter" && value) {
    if (!/^[a-z0-9_]{1,80}$/.test(value))
      return failure(400, "invalid_request", "That deck filter is not a starter deck.");
    return { starterDeckId: value };
  }
  return failure(400, "invalid_request", "Deck filters look like \u201Cpersonal:Deck name\u201D or \u201Cstarter:deck_id\u201D.");
}
var PERSONAL_LATEST_EVENTS = `SELECT card_id, next_due FROM (
  SELECT card_id, next_due, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY rated_at DESC, rowid DESC) AS rn
  FROM card_rating_events WHERE account_id = ?) WHERE rn = 1`;
var STARTER_LATEST_EVENTS = `SELECT deck_id, stable_id, next_due FROM (
  SELECT deck_id, stable_id, next_due, ROW_NUMBER() OVER (PARTITION BY deck_id, stable_id ORDER BY rated_at DESC, rowid DESC) AS rn
  FROM starter_card_rating_events WHERE account_id = ?) WHERE rn = 1`;
var CURRENT_STARTER_VERSIONS = `SELECT deck_id, MAX(version) AS version FROM starter_deck_versions WHERE status = 'published' GROUP BY deck_id`;
async function personalDeckCounts(env, accountId, today2, filter) {
  const rows3 = await env.DB.prepare(
    `SELECT c.deck AS deck, COUNT(*) AS total,
       SUM(CASE WHEN l.next_due IS NULL OR l.next_due <= ? THEN 1 ELSE 0 END) AS due
     FROM personal_cards c
     LEFT JOIN (${PERSONAL_LATEST_EVENTS}) l ON l.card_id = c.id
     WHERE c.account_id = ? AND c.archived_at IS NULL${filter.personalDeckKey ? " AND c.deck_key = ?" : ""}
     GROUP BY c.deck ORDER BY c.deck`
  ).bind(...filter.personalDeckKey ? [today2, accountId, accountId, filter.personalDeckKey] : [today2, accountId, accountId]).all();
  return rows3.results;
}
async function starterDeckCounts(env, accountId, today2, filter) {
  const rows3 = await env.DB.prepare(
    `SELECT v.deck_id, v.title, v.version, COUNT(*) AS total,
       SUM(CASE WHEN l.next_due IS NULL OR l.next_due <= ? THEN 1 ELSE 0 END) AS due
     FROM starter_deck_cards k
     JOIN starter_deck_versions v ON v.deck_id = k.deck_id AND v.version = k.version
     JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = v.deck_id AND cur.version = v.version
     LEFT JOIN (${STARTER_LATEST_EVENTS}) l ON l.deck_id = k.deck_id AND l.stable_id = k.stable_id
     ${filter.starterDeckId ? "WHERE v.deck_id = ?" : ""}
     GROUP BY v.deck_id, v.title, v.version ORDER BY v.deck_id`
  ).bind(...filter.starterDeckId ? [today2, accountId, filter.starterDeckId] : [today2, accountId]).all();
  return rows3.results;
}
async function overview(request, env, session2, now) {
  const url = new URL(request.url);
  const zone = await effectiveZone(env, session2.account_id, url.searchParams.get("zone"));
  if (zone instanceof Response) return zone;
  const filter = parseDeckFilter(url.searchParams.get("deck"));
  if (filter instanceof Response) return filter;
  const today2 = localCalendarDate(now, zone.zone);
  const [personal, starter] = await Promise.all([
    personalDeckCounts(env, session2.account_id, today2, filter),
    starterDeckCounts(env, session2.account_id, today2, filter)
  ]);
  return json({
    studyDate: today2,
    zone: zone.zone,
    zoneSource: zone.source,
    totalDue: personal.reduce((sum, deck) => sum + Number(deck.due), 0) + starter.reduce((sum, deck) => sum + Number(deck.due), 0),
    personal: personal.map((deck) => ({ deck: deck.deck, total: Number(deck.total), due: Number(deck.due) })),
    starter: starter.map((deck) => ({
      deckId: deck.deck_id,
      title: deck.title,
      version: deck.version,
      total: Number(deck.total),
      due: Number(deck.due)
    }))
  });
}
function dueCardJson(row) {
  const card = row.kind === "personal" ? { key: `personal:${row.card_id}`, kind: "personal", ref: { kind: "personal", cardId: row.card_id }, deck: row.deck_label } : { key: `starter:${row.deck_id}:${row.stable_id}`, kind: "starter", ref: { kind: "starter", deckId: row.deck_id, stableId: row.stable_id }, deck: row.deck_id, deckTitle: row.title };
  card.front = row.front;
  if (row.due_date) card.dueDate = row.due_date;
  for (const [field, value] of Object.entries({
    definition: row.definition,
    vietnamese: row.vietnamese,
    partOfSpeech: row.part_of_speech,
    pronunciation: row.pronunciation,
    synonyms: row.synonyms,
    example: row.example,
    exampleVi: row.example_vi,
    level: row.cefr
  })) {
    if (value) card[field] = value;
  }
  return card;
}
async function dueCards(request, env, session2, now) {
  const url = new URL(request.url);
  const zone = await effectiveZone(env, session2.account_id, url.searchParams.get("zone"));
  if (zone instanceof Response) return zone;
  const filter = parseDeckFilter(url.searchParams.get("deck"));
  if (filter instanceof Response) return filter;
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get("limit") ?? String(PAGE_DEFAULT)) || PAGE_DEFAULT));
  const today2 = localCalendarDate(now, zone.zone);
  const accountId = session2.account_id;
  const personalWhere = filter.personalDeckKey ? " AND c.deck_key = ?" : filter.starterDeckId ? " AND 1 = 0" : "";
  const starterWhere = filter.starterDeckId ? "WHERE v.deck_id = ?" : filter.personalDeckKey ? "WHERE 1 = 0" : "";
  const rows3 = await env.DB.prepare(
    `SELECT * FROM (
       SELECT 'personal' AS kind, c.id AS card_id, NULL AS deck_id, NULL AS stable_id,
              c.deck AS deck_label, '' AS title, 0 AS version, c.front,
              c.definition, c.vietnamese, c.part_of_speech, c.pronunciation, c.synonyms, c.example,
              '' AS example_vi, '' AS cefr, l.next_due AS due_date
       FROM personal_cards c
       LEFT JOIN (${PERSONAL_LATEST_EVENTS}) l ON l.card_id = c.id
       WHERE c.account_id = ? AND c.archived_at IS NULL AND (l.next_due IS NULL OR l.next_due <= ?)${personalWhere}
       UNION ALL
       SELECT 'starter' AS kind, NULL AS card_id, k.deck_id AS deck_id, k.stable_id AS stable_id,
              v.title AS deck_label, v.title AS title, v.version, k.front,
              k.definition_en, k.meaning_vi, k.part_of_speech, k.ipa, k.synonyms,
              COALESCE(NULLIF(k.example_en, ''), k.example_vi), k.example_vi, k.cefr, l.next_due AS due_date
       FROM starter_deck_cards k
       JOIN starter_deck_versions v ON v.deck_id = k.deck_id AND v.version = k.version
       JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = v.deck_id AND cur.version = v.version
       LEFT JOIN (${STARTER_LATEST_EVENTS}) l ON l.deck_id = k.deck_id AND l.stable_id = k.stable_id
       ${starterWhere}
     )
     WHERE (due_date IS NULL OR due_date <= ?)
     ORDER BY (due_date IS NOT NULL), due_date, kind, deck_label, COALESCE(card_id, stable_id)
     LIMIT ? OFFSET ?`
  ).bind(...[
    accountId,
    accountId,
    today2,
    ...filter.personalDeckKey ? [filter.personalDeckKey] : [],
    accountId,
    ...filter.starterDeckId ? [filter.starterDeckId] : [],
    today2,
    limit,
    offset
  ]).all();
  const cards = rows3.results.map(dueCardJson);
  return json({ studyDate: today2, zone: zone.zone, zoneSource: zone.source, cards });
}
function isCardRefId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= CARD_ID_MAX;
}
function parseRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value;
  if (ref.kind === "personal" && isCardRefId(ref.cardId)) return { kind: "personal", cardId: ref.cardId };
  if (ref.kind === "starter" && isCardRefId(ref.deckId) && isCardRefId(ref.stableId))
    return { kind: "starter", deckId: ref.deckId, stableId: ref.stableId };
  return null;
}
async function rate(request, env, session2, now) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  let body2;
  try {
    const raw = await request.text();
    if (raw.length > BODY_MAX2) return failure(413, "too_large", "That rating request is too large.");
    body2 = JSON.parse(raw);
    if (!body2 || typeof body2 !== "object" || Array.isArray(body2)) throw new Error("not an object");
  } catch {
    return failure(400, "invalid_request", "Send the rating as JSON.");
  }
  if (Object.keys(body2).some((key2) => key2 !== "ref" && key2 !== "rating" && key2 !== "requestId" && key2 !== "zone"))
    return failure(400, "invalid_request", "Only a card reference, rating, request id, and zone can be sent here.");
  const ref = parseRef(body2.ref);
  if (!ref) return failure(400, "invalid_request", "Identify the card to rate.");
  const requestId = body2.requestId;
  if (typeof requestId !== "string" || requestId.length < 8 || requestId.length > REQUEST_ID_MAX)
    return failure(400, "invalid_request", "A rating needs a request id so it can be applied exactly once.");
  const ratingInput = body2.rating;
  if (!isCardRating(ratingInput))
    return failure(400, "invalid_request", "Rate the card as Not sure or Sure.");
  const rating = ratingInput;
  const zone = await effectiveZone(env, session2.account_id, typeof body2.zone === "string" ? body2.zone : null);
  if (zone instanceof Response) return zone;
  const today2 = localCalendarDate(now, zone.zone);
  const due = nextDueDate(rating, today2);
  const eventId = await sha2562(`${session2.account_id}:${requestId}`);
  const ratedAt = Math.floor(now / 1e3);
  if (ref.kind === "personal") {
    const card2 = await env.DB.prepare(
      "SELECT id FROM personal_cards WHERE id = ? AND account_id = ? AND archived_at IS NULL"
    ).bind(ref.cardId, session2.account_id).first();
    if (!card2) return failure(404, "not_in_study", "That card is not available for study.");
    const applied2 = await env.DB.prepare(
      `INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`
    ).bind(eventId, ref.cardId, session2.account_id, rating, zone.zone, due, ratedAt).run();
    if (!applied2.meta.changes) {
      const existing = await env.DB.prepare("SELECT next_due FROM card_rating_events WHERE id = ?").bind(eventId).first();
      return json({ applied: false, dueDate: existing?.next_due ?? due, zone: zone.zone, zoneSource: zone.source });
    }
    return json({ applied: true, dueDate: due, zone: zone.zone, zoneSource: zone.source });
  }
  const card = await env.DB.prepare(
    `SELECT k.stable_id FROM starter_deck_cards k
     JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = k.deck_id AND cur.version = k.version
     WHERE k.deck_id = ? AND k.stable_id = ? LIMIT 1`
  ).bind(ref.deckId, ref.stableId).first();
  if (!card) return failure(404, "not_in_study", "That starter card is not available for study.");
  const applied = await env.DB.prepare(
    `INSERT INTO starter_card_rating_events (id, account_id, deck_id, stable_id, rating, rating_zone, next_due, rated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`
  ).bind(eventId, session2.account_id, ref.deckId, ref.stableId, rating, zone.zone, due, ratedAt).run();
  if (!applied.meta.changes) {
    const existing = await env.DB.prepare("SELECT next_due FROM starter_card_rating_events WHERE id = ?").bind(eventId).first();
    return json({ applied: false, dueDate: existing?.next_due ?? due, zone: zone.zone, zoneSource: zone.source });
  }
  return json({ applied: true, dueDate: due, zone: zone.zone, zoneSource: zone.source });
}
function studyRoute(request, env, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cards/study")) return null;
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method === "GET" && path === "/api/cards/study") return overview(request, env, session2, now());
    if (request.method === "GET" && path === "/api/cards/study/cards") return dueCards(request, env, session2, now());
    if (request.method === "POST" && path === "/api/cards/study/rate") return rate(request, env, session2, now());
    return failure(404, "not_found", "This study action is unavailable.");
  })();
}

// hosted/src/library.ts
var ID = "[A-Za-z0-9_-]+";
var QUESTION = new RegExp(`^/api/library/(${ID})/questions/(${ID})$`);
var VISUAL = new RegExp(`^/content/(${ID})/(${ID})/([A-Za-z0-9_-]+\\.(?:png|webp|jpe?g))$`);
async function rows(statement) {
  return (await statement.all()).results;
}
async function hasPackageEntitlement(env, accountId, revisionId) {
  const row = await env.DB.prepare(`SELECT p.id FROM package_revisions p WHERE p.id = ? AND (
    EXISTS (SELECT 1 FROM activated_publication_releases a JOIN publication_release_revisions r
      ON r.release_id = a.release_id WHERE r.revision_id = p.id)
    OR EXISTS (SELECT 1 FROM private_revision_entitlements e
      WHERE e.revision_id = p.id AND e.account_id = ?))`).bind(revisionId, accountId).first();
  return !!row;
}
async function listing(env, accountId) {
  const packages = await rows(env.DB.prepare(`SELECT p.id, p.family_id, p.title, p.source_revision,
      p.published_revision, p.question_count FROM package_revisions p WHERE
      EXISTS (SELECT 1 FROM active_publication a JOIN publication_release_revisions r
        ON r.release_id = a.release_id WHERE r.revision_id = p.id)
      OR EXISTS (SELECT 1 FROM private_revision_entitlements e
        WHERE e.revision_id = p.id AND e.account_id = ?)
      ORDER BY p.title, p.published_revision`).bind(accountId));
  return json({ packages: packages.map((item) => ({
    revisionId: item.id,
    familyId: item.family_id,
    title: item.title,
    sourceRevision: item.source_revision,
    publishedRevision: item.published_revision,
    questionCount: item.question_count
  })) });
}
async function question(env, revisionId, questionId) {
  const row = await env.DB.prepare(`SELECT question_id, ordinal, section, module, question_number,
      response_type, presentation_json FROM publication_questions
      WHERE revision_id = ? AND question_id = ?`).bind(revisionId, questionId).first();
  if (!row) return failure(404, "not_found", "This question is unavailable.");
  return json({
    revisionId,
    questionId: row.question_id,
    ordinal: row.ordinal,
    section: row.section,
    module: row.module,
    questionNumber: row.question_number,
    responseType: row.response_type,
    presentation: JSON.parse(row.presentation_json)
  });
}
async function questions(env, revisionId) {
  const items = await rows(
    env.DB.prepare(`SELECT pq.question_id, pq.ordinal, pq.section, pq.module, pq.question_number, pc.category
      FROM publication_questions pq LEFT JOIN publication_question_categories pc
        ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id
      WHERE pq.revision_id = ? ORDER BY pq.ordinal`).bind(revisionId)
  );
  return json({ revisionId, questions: items.map((item) => ({
    questionId: item.question_id,
    ordinal: item.ordinal,
    section: item.section,
    module: item.module,
    questionNumber: item.question_number,
    category: item.category
  })) });
}
async function visual(request, env, revisionId, questionId) {
  const path = new URL(request.url).pathname;
  const row = await env.DB.prepare(`SELECT path, content_type, sha256, byte_size
      FROM publication_assets WHERE path = ? AND revision_id = ? AND question_id = ?`).bind(path, revisionId, questionId).first();
  if (!row) return failure(404, "not_found", "This visual is unavailable.");
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return failure(503, "visual_unavailable", "This visual could not be loaded.");
  const bytes2 = await asset.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes2)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (bytes2.byteLength !== row.byte_size || hash !== row.sha256)
    return failure(503, "visual_unavailable", "This visual could not be loaded.");
  return new Response(bytes2, { headers: {
    ...noStore,
    "Content-Type": row.content_type,
    "Content-Security-Policy": "default-src 'none'; sandbox"
  } });
}
function libraryRoute(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/library") && !path.startsWith("/content/")) return null;
  if (path.startsWith("/content/") && !VISUAL.test(path)) return null;
  if (request.method !== "GET") return Promise.resolve(failure(404, "not_found", "This content is unavailable."));
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to open the library.");
    if (path === "/api/library") return listing(env, session2.account_id);
    const questionMatch = QUESTION.exec(path);
    const listMatch = new RegExp(`^/api/library/(${ID})/questions$`).exec(path);
    const visualMatch = VISUAL.exec(path);
    const revisionId = questionMatch?.[1] ?? listMatch?.[1] ?? visualMatch?.[1];
    if (!revisionId || !await hasPackageEntitlement(env, session2.account_id, revisionId))
      return failure(404, "not_found", "This content is unavailable.");
    if (questionMatch) return question(env, revisionId, questionMatch[2]);
    if (listMatch) return questions(env, revisionId);
    if (visualMatch) return visual(request, env, revisionId, visualMatch[2]);
    return failure(404, "not_found", "This content is unavailable.");
  })();
}

// hosted/src/attempts.ts
var ROOT = "/api/attempts";
var MAX_BODY_CHARS = 65536;
var EDITOR_LEASE_MS = 12e4;
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function bodyObject(request) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return failure(400, "invalid_attempt", "The Attempt request could not be read.");
  }
  if (raw.length > MAX_BODY_CHARS) return failure(413, "request_too_large", "This Attempt request is too large.");
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : failure(400, "invalid_attempt", "The Attempt request is invalid.");
  } catch {
    return failure(400, "invalid_attempt", "The Attempt request is invalid.");
  }
}
function parseConfig(value) {
  const section = value.section;
  const kind = value.kind;
  if (kind === "section_exam") {
    if (section !== "Math" && section !== "Reading and Writing")
      return failure(400, "invalid_attempt", "Choose a supported Section: Math or Reading and Writing.");
    if (value.category !== void 0 && value.category !== null)
      return failure(400, "invalid_attempt", "Question Category is available for Practice Attempts only.");
    return {
      kind,
      category: null,
      section,
      modules: [1, 2],
      count: section === "Math" ? 44 : 54,
      ordering: "random",
      timing: { mode: "sat_paced" }
    };
  }
  if (kind !== void 0 && kind !== "practice")
    return failure(400, "invalid_attempt", "Choose a supported Attempt kind.");
  const category = value.category;
  if (category !== void 0 && category !== null && (typeof category !== "string" || !category.trim()))
    return failure(400, "invalid_attempt", "Choose a valid Question Category.");
  const modules = value.modules;
  const count = value.count;
  const ordering = value.ordering;
  const timingValue = value.timing;
  if (typeof section !== "string" || section !== "Math" && section !== "Reading and Writing" || !Array.isArray(modules) || modules.length === 0 || modules.length > 2 || !modules.every((item) => Number.isInteger(item) && (item === 1 || item === 2)) || new Set(modules).size !== modules.length || !Number.isInteger(count) || Number(count) <= 0 || ordering !== "source" && ordering !== "random" || !isObject(timingValue)) {
    return failure(400, "invalid_attempt", "Choose a valid Section, Module, question count, order, and timing.");
  }
  let timing;
  if (timingValue.mode === "elapsed") {
    timing = { mode: "elapsed" };
  } else if (timingValue.mode === "custom" && Number.isInteger(timingValue.durationSeconds) && Number(timingValue.durationSeconds) > 0 && Number(timingValue.durationSeconds) <= 86400) {
    timing = { mode: "custom", durationSeconds: Number(timingValue.durationSeconds) };
  } else if (timingValue.mode === "sat_paced") {
    timing = { mode: "sat_paced" };
  } else {
    return failure(400, "invalid_attempt", "Choose a valid Practice timing option.");
  }
  return {
    kind: "practice",
    category: typeof category === "string" ? category : null,
    section,
    modules: [...modules],
    count: Number(count),
    ordering,
    timing
  };
}
async function rows2(statement) {
  return (await statement.all()).results;
}
async function attemptRow(env, accountId, attemptId) {
  return env.DB.prepare("SELECT id, account_id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, completed_at_ms, result_json, editor_token_hash, editor_lease_expires_at_ms, assisted_at_ms FROM learner_attempts WHERE id = ? AND account_id = ?").bind(attemptId, accountId).first();
}
function parseQuestions(row) {
  return JSON.parse(row.questions_json);
}
function parseState(row) {
  return JSON.parse(row.state_json);
}
function snapshot(row, serverNow) {
  const config = JSON.parse(row.config_json);
  const questions2 = parseQuestions(row);
  return {
    attemptId: row.id,
    revisionId: row.revision_id,
    kind: row.kind,
    status: row.status,
    section: config.section,
    category: config.category ?? null,
    modules: config.modules,
    ordering: config.ordering,
    timing: config.timing,
    questionIds: questions2.map((question3) => question3.questionId),
    questions: questions2,
    state: parseState(row),
    stateVersion: row.state_version,
    createdAt: row.created_at_ms,
    startedAt: row.started_at_ms,
    deadlineAt: row.deadline_at_ms,
    completedAt: row.completed_at_ms,
    assisted: row.assisted_at_ms !== null,
    lease: {
      held: row.editor_lease_expires_at_ms !== null && row.editor_lease_expires_at_ms > serverNow,
      expiresAt: row.editor_lease_expires_at_ms
    },
    serverNow
  };
}
function summary(row) {
  const config = JSON.parse(row.config_json);
  return {
    attemptId: row.id,
    revisionId: row.revision_id,
    kind: row.kind,
    status: row.status,
    section: config.section,
    category: config.category ?? null,
    questionCount: parseQuestions(row).length,
    createdAt: row.created_at_ms,
    startedAt: row.started_at_ms,
    deadlineAt: row.deadline_at_ms,
    completedAt: row.completed_at_ms,
    assisted: row.assisted_at_ms !== null
  };
}
async function listAttempts(env, accountId, now) {
  const items = await rows2(env.DB.prepare("SELECT id, account_id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, completed_at_ms, result_json, editor_token_hash, assisted_at_ms FROM learner_attempts WHERE account_id = ? ORDER BY created_at_ms DESC").bind(accountId));
  const current = await Promise.all(items.map((row) => enforceSectionDeadline(env, row, now)));
  if (current.some((row) => !row)) return failure(503, "attempt_unavailable", "Whitebook could not refresh Attempt history. Try again.");
  return json({ attempts: current.map((row) => summary(row)) });
}
function shuffle(items) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) {
    const word = new Uint32Array(1);
    crypto.getRandomValues(word);
    const j = word[0] % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}
function durationMs(config, questions2) {
  if (config.kind === "section_exam")
    return config.section === "Math" ? 35 * 6e4 : 32 * 6e4;
  if (config.timing.mode === "elapsed") return null;
  if (config.timing.mode === "custom") return config.timing.durationSeconds * 1e3;
  if (questions2.length !== config.count || config.modules.length !== 1) return null;
  if (config.section === "Math" && questions2.length === 22) return 35 * 6e4;
  if (config.section === "Reading and Writing" && questions2.length === 27) return 32 * 6e4;
  return null;
}
async function createAttempt(request, env, accountId, now) {
  const body2 = await bodyObject(request);
  if (body2 instanceof Response) return body2;
  const revisionId = body2.revisionId;
  if (typeof revisionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(revisionId))
    return failure(400, "invalid_attempt", "Choose one valid Test Package revision.");
  const config = parseConfig(body2);
  if (config instanceof Response) return config;
  if (!await hasPackageEntitlement(env, accountId, revisionId))
    return failure(404, "not_found", "This Test Package is unavailable.");
  const sectionExam = config.kind === "section_exam";
  const placeholders = config.modules.map(() => "?").join(", ");
  const candidates = sectionExam ? await rows2(env.DB.prepare("SELECT question_id, ordinal, section, module, question_number, response_type, presentation_json FROM publication_questions WHERE revision_id = ? AND section = ? ORDER BY ordinal").bind(revisionId, config.section)) : await rows2(env.DB.prepare("SELECT question_id, ordinal, section, module, question_number, response_type, presentation_json FROM publication_questions WHERE revision_id = ? AND section = ? AND module IN (" + placeholders + ") ORDER BY ordinal").bind(revisionId, config.section, ...config.modules));
  let filtered = candidates;
  if (config.category) {
    const metadata = await rows2(env.DB.prepare(
      "SELECT question_id, category FROM publication_question_categories WHERE revision_id = ?"
    ).bind(revisionId));
    if (!metadata.some((item) => item.category === config.category))
      return failure(400, "invalid_attempt", "Choose a published Question Category for this Test Package.");
    const byQuestion = new Map(metadata.map((item) => [item.question_id, item.category]));
    filtered = candidates.filter((question3) => byQuestion.get(question3.question_id) === config.category);
    if (filtered.length === 0)
      return failure(400, "invalid_attempt", "No questions in this Question Category match the selected Section and Modules.");
  }
  const eligible = sectionExam ? [...new Map(filtered.map((question3) => [question3.question_id, question3])).values()] : filtered;
  if (config.count > eligible.length)
    return failure(400, "invalid_attempt", sectionExam ? `This Section needs at least ${config.count} unique questions to create a Section Exam.` : config.category ? `Only ${eligible.length} questions in this Question Category match the selected Section and Modules.` : "The selected question count exceeds this Section and Module selection.");
  if (!sectionExam && config.timing.mode === "sat_paced" && (config.modules.length !== 1 || !(config.section === "Math" && config.count === 22 || config.section === "Reading and Writing" && config.count === 27) || filtered.length !== config.count)) {
    return failure(400, "invalid_attempt", "SAT-Paced Timing requires one complete Module.");
  }
  const selected = config.ordering === "random" ? shuffle(eligible).slice(0, config.count) : eligible.slice(0, config.count);
  const moduleSize = config.section === "Math" ? 22 : 27;
  const questions2 = selected.map((question3, index) => {
    const presentation = JSON.parse(question3.presentation_json);
    const choiceIds = Array.isArray(presentation.choices) ? presentation.choices.flatMap((choice) => typeof choice.id === "string" && /^[A-D]$/.test(choice.id) ? [choice.id] : []) : [];
    return {
      questionId: question3.question_id,
      ordinal: question3.ordinal,
      section: question3.section,
      module: sectionExam ? Math.floor(index / moduleSize) + 1 : question3.module,
      questionNumber: question3.question_number,
      responseType: question3.response_type,
      choiceIds
    };
  });
  const questionIds = questions2.map((question3) => question3.questionId);
  if (new Set(questionIds).size !== questionIds.length)
    return failure(503, "attempt_unavailable", "Whitebook could not prepare this Attempt. Try again.");
  const id = crypto.randomUUID();
  const state = sectionExam ? {
    phase: "module",
    activeModule: 1,
    lockedModules: [],
    responses: {},
    markedQuestionIds: [],
    eliminatedChoices: {},
    currentQuestionId: questionIds[0],
    remainingSeconds: null,
    pausedPhase: null,
    calculatorState: null,
    questionElapsedMs: {}
  } : {
    responses: {},
    markedQuestionIds: [],
    eliminatedChoices: {},
    currentQuestionId: questionIds[0],
    questionElapsedMs: {}
  };
  const result = await env.DB.prepare("INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms) VALUES (?, ?, ?, ?, 'preparing', ?, ?, ?, 0, ?)").bind(
    id,
    accountId,
    revisionId,
    sectionExam ? "section_exam" : "practice",
    JSON.stringify(config),
    JSON.stringify(questions2),
    JSON.stringify(state),
    now
  ).run();
  if (!result.success || result.meta.changes !== 1)
    return failure(503, "attempt_unavailable", "Whitebook could not create this Attempt. Try again.");
  const row = await attemptRow(env, accountId, id);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(row, now), 201);
}
function editorToken() {
  const bytes2 = new Uint8Array(32);
  crypto.getRandomValues(bytes2);
  return Array.from(bytes2, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha2563(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function startAttempt(env, accountId, attemptId, now) {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  if (row.status !== "preparing") return failure(409, "attempt_changed", "This Attempt is no longer waiting to start.");
  const config = JSON.parse(row.config_json);
  const questions2 = parseQuestions(row);
  const duration = durationMs(config, questions2);
  if (config.timing.mode !== "elapsed" && duration === null)
    return failure(409, "attempt_changed", "This Attempt no longer has a valid timing selection.");
  const token = editorToken();
  const expiresAt = now + EDITOR_LEASE_MS;
  const state = parseState(row);
  state.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, status = 'active', started_at_ms = ?, deadline_at_ms = ?, editor_token_hash = ?, editor_lease_expires_at_ms = ?, state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'preparing'").bind(
    JSON.stringify(state),
    now,
    duration === null ? null : now + duration,
    await sha2563(token),
    expiresAt,
    attemptId,
    accountId
  ).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not start this Attempt. Try again.");
  if (result.meta.changes !== 1) return failure(409, "attempt_changed", "This Attempt has already changed.");
  const started = await attemptRow(env, accountId, attemptId);
  if (!started) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(started, now), editorToken: token });
}
function checkpointQuestionTime(source, at, deadlineAt) {
  const state = { ...source };
  const questionId = state.currentQuestionId;
  const startedAt = state.questionTimingStartedAtMs;
  if (typeof questionId !== "string" || typeof startedAt !== "number") return state;
  const endAt = deadlineAt === null ? at : Math.min(at, deadlineAt);
  const elapsed = Math.max(0, endAt - startedAt);
  const previous = isObject(state.questionElapsedMs) ? state.questionElapsedMs : {};
  state.questionElapsedMs = { ...previous, [questionId]: Number(previous[questionId] ?? 0) + elapsed };
  state.questionTimingStartedAtMs = endAt;
  return state;
}
async function gradeSectionExam(env, row, state) {
  const questions2 = parseQuestions(row);
  const answerRows = await rows2(env.DB.prepare("SELECT question_id, accepted_answers_json FROM publication_answers WHERE revision_id = ?").bind(row.revision_id));
  const answers = new Map(answerRows.map((answer) => [answer.question_id, JSON.parse(answer.accepted_answers_json)]));
  if (questions2.some((question3) => !answers.has(question3.questionId))) return null;
  const responses = isObject(state.responses) ? state.responses : {};
  const graded = questions2.map((question3) => {
    const acceptedAnswers = answers.get(question3.questionId);
    const response = typeof responses[question3.questionId] === "string" ? responses[question3.questionId] : null;
    const correct = response !== null && acceptedAnswers.some((answer) => answer.trim().toLocaleLowerCase() === response.trim().toLocaleLowerCase());
    return { questionId: question3.questionId, response, acceptedAnswers, correct };
  });
  return {
    correctCount: graded.filter((question3) => question3.correct).length,
    questionCount: graded.length,
    questions: graded
  };
}
async function closeSectionExamModule(env, row, now, closedAt, exposeAnswers = false) {
  const state = parseState(row);
  if (row.kind !== "section_exam" || state.phase !== "module" || row.deadline_at_ms === null) return row;
  const closeTime = Math.min(closedAt, now);
  const checkpointAt = Math.min(closeTime, row.deadline_at_ms);
  const closedState = checkpointQuestionTime(state, checkpointAt, row.deadline_at_ms);
  const activeModule = Number(closedState.activeModule);
  const locked = Array.isArray(closedState.lockedModules) ? closedState.lockedModules.filter(Number.isInteger) : [];
  closedState.lockedModules = [.../* @__PURE__ */ new Set([...locked, activeModule])].sort();
  closedState.questionTimingStartedAtMs = null;
  closedState.remainingSeconds = null;
  closedState.pausedPhase = null;
  if (activeModule === 1) {
    closedState.phase = "transition";
    const update2 = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, deadline_at_ms = NULL, state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND deadline_at_ms = ?").bind(JSON.stringify(closedState), row.id, row.account_id, row.state_version, row.deadline_at_ms).run();
    if (!update2.success) return null;
    return attemptRow(env, row.account_id, row.id);
  }
  const result = await gradeSectionExam(env, row, closedState);
  if (!result) return null;
  const update = await env.DB.prepare("UPDATE learner_attempts SET status = 'completed', state_json = ?, deadline_at_ms = NULL, completed_at_ms = ?, result_json = ?, answers_exposed_at_ms = ?, editor_token_hash = NULL, editor_lease_expires_at_ms = NULL, state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND deadline_at_ms = ?").bind(
    JSON.stringify(closedState),
    closeTime,
    JSON.stringify(result),
    exposeAnswers ? now : null,
    row.id,
    row.account_id,
    row.state_version,
    row.deadline_at_ms
  ).run();
  if (!update.success) return null;
  return attemptRow(env, row.account_id, row.id);
}
async function enforceSectionDeadline(env, row, now) {
  if (row.kind !== "section_exam" || row.status !== "active" || row.deadline_at_ms === null || row.deadline_at_ms > now)
    return row;
  const next = await closeSectionExamModule(env, row, now, row.deadline_at_ms);
  if (next) return next;
  return attemptRow(env, row.account_id, row.id);
}
async function getAttempt(env, accountId, attemptId, now) {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  const current = await enforceSectionDeadline(env, row, now);
  if (!current) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  return json(snapshot(current, now));
}
function parseVersion(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
function parseEditorToken(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function sameSecret(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function parseChange(value, questions2) {
  if (!isObject(value)) return null;
  if (value.type === "calculator_state" && isObject(value.state) && JSON.stringify(value.state).length <= 48e3)
    return { type: "calculator_state", state: value.state };
  if (typeof value.questionId !== "string") return null;
  const question3 = questions2.find((item) => item.questionId === value.questionId);
  if (!question3) return null;
  const questionId = question3.questionId;
  if (value.type === "highlights" && question3.section === "Reading and Writing" && Array.isArray(value.highlights) && value.highlights.length <= 100) {
    const valid = value.highlights.every((item) => {
      if (!isObject(item) || typeof item.block !== "string" || !/^(?:stem|stimulus|choice:[A-D]):\d{1,4}(?::\d{1,4})?$/.test(item.block)) return false;
      if (item.kind === "text") return Object.keys(item).length === 4 && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && Number(item.start) >= 0 && Number(item.end) > Number(item.start) && Number(item.end) <= 1e5;
      if (item.kind !== "region" || Object.keys(item).length !== 6) return false;
      if (![item.x, item.y, item.width, item.height].every((number) => typeof number === "number" && Number.isFinite(number))) return false;
      return Number(item.x) >= 0 && Number(item.y) >= 0 && Number(item.width) > 0 && Number(item.height) > 0 && Number(item.x) + Number(item.width) <= 1.000001 && Number(item.y) + Number(item.height) <= 1.000001;
    });
    if (valid) return { type: "highlights", questionId, highlights: value.highlights };
  }
  if (value.type === "response" && (value.response === null || typeof value.response === "string" && value.response.length <= 4096 && (question3.responseType !== "multiple_choice" || question3.choiceIds.includes(value.response))))
    return { type: "response", questionId, response: value.response };
  if (value.type === "mark" && typeof value.marked === "boolean")
    return { type: "mark", questionId, marked: value.marked };
  if (value.type === "elimination" && typeof value.choiceId === "string" && question3.responseType === "multiple_choice" && question3.choiceIds.includes(value.choiceId) && typeof value.eliminated === "boolean")
    return { type: "elimination", questionId, choiceId: value.choiceId, eliminated: value.eliminated };
  if (value.type === "navigation") return { type: "navigation", questionId };
  return null;
}
function applyChange(source, change) {
  const previous = source;
  const state = {
    ...source,
    responses: { ...previous.responses },
    markedQuestionIds: [...previous.markedQuestionIds],
    eliminatedChoices: Object.fromEntries(Object.entries(previous.eliminatedChoices).map(([questionId, choices]) => [questionId, [...choices]])),
    currentQuestionId: previous.currentQuestionId
  };
  if (change.type === "highlights") {
    state.highlights = { ...isObject(source.highlights) ? source.highlights : {}, [change.questionId]: change.highlights };
  } else if (change.type === "response") {
    if (change.response === null) delete state.responses[change.questionId];
    else state.responses[change.questionId] = change.response;
  } else if (change.type === "mark") {
    state.markedQuestionIds = change.marked ? [.../* @__PURE__ */ new Set([...state.markedQuestionIds, change.questionId])] : state.markedQuestionIds.filter((id) => id !== change.questionId);
  } else if (change.type === "elimination") {
    const choices = new Set(state.eliminatedChoices[change.questionId] ?? []);
    if (change.eliminated) choices.add(change.choiceId);
    else choices.delete(change.choiceId);
    if (choices.size) state.eliminatedChoices[change.questionId] = [...choices].sort();
    else delete state.eliminatedChoices[change.questionId];
  } else if (change.type === "navigation") {
    state.currentQuestionId = change.questionId;
  } else {
    state.calculatorState = change.state;
  }
  return state;
}
async function validateMutable(row, token, expectedVersion, now) {
  if (row.status !== "active") return failure(409, "attempt_changed", "This Attempt is no longer editable.");
  if (row.deadline_at_ms !== null && row.deadline_at_ms <= now)
    return failure(409, "attempt_expired", "The timed Attempt has ended.");
  if (expectedVersion === null || expectedVersion !== row.state_version)
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  if (row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= now)
    return failure(409, "editor_lease_expired", "Editing is unavailable. Take over editing to continue.");
  if (!token || !row.editor_token_hash || !sameSecret(await sha2563(token), row.editor_token_hash))
    return failure(409, "editor_conflict", "This Attempt is being edited on another device. Refresh or take over editing.");
  return null;
}
async function readBody2(request) {
  const body2 = await bodyObject(request);
  if (body2 instanceof Response) return body2;
  return body2;
}
async function updateEditorState(env, row, token, state, now) {
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, state_version = state_version + 1, editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)").bind(
    JSON.stringify(state),
    now + EDITOR_LEASE_MS,
    row.id,
    row.account_id,
    row.state_version,
    await sha2563(token),
    now,
    now
  ).run();
  return result.success && result.meta.changes === 1;
}
async function updateSectionLifecycle(env, row, token, state, deadlineAt, now) {
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, deadline_at_ms = ?, state_version = state_version + 1, editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? AND deadline_at_ms IS ?").bind(
    JSON.stringify(state),
    deadlineAt,
    now + EDITOR_LEASE_MS,
    row.id,
    row.account_id,
    row.state_version,
    await sha2563(token),
    now,
    row.deadline_at_ms
  ).run();
  return result.success && result.meta.changes === 1;
}
async function finishModule(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Only a Section Exam closes one Module at a time.");
  const token = parseEditorToken(body2.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body2.expectedStateVersion), now);
  if (denied) return denied;
  if (parseState(row).phase !== "module")
    return failure(409, "attempt_changed", "There is no running Module to finish.");
  const updated = await closeSectionExamModule(env, row, now, now, true);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not close this Module. Try again.");
  const result = updated.status === "completed" && updated.result_json ? { result: JSON.parse(updated.result_json) } : {};
  return json({ ...snapshot(updated, now), ...result });
}
async function continueSectionExam(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "This Attempt has no Section Exam transition.");
  const token = parseEditorToken(body2.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body2.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "transition" || Number(state.activeModule) !== 1)
    return failure(409, "attempt_changed", "Module 2 can start only from the Section Exam transition.");
  const questions2 = parseQuestions(row);
  const first = questions2.find((question3) => question3.module === 2);
  if (!first) return failure(503, "attempt_unavailable", "Module 2 questions are unavailable.");
  const config = JSON.parse(row.config_json);
  const nextState = {
    ...state,
    phase: "module",
    activeModule: 2,
    currentQuestionId: first.questionId,
    remainingSeconds: null,
    pausedPhase: null,
    questionTimingStartedAtMs: now
  };
  const deadlineAt = now + (durationMs(config, questions2) ?? 0);
  if (!await updateSectionLifecycle(env, row, token, nextState, deadlineAt, now))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before continuing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(updated, now));
}
async function pauseSectionExam(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Pause is unavailable for this Attempt.");
  const token = parseEditorToken(body2.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body2.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "module" && state.phase !== "transition")
    return failure(409, "attempt_changed", "This Attempt is already paused or closed.");
  const pausedPhase = state.phase;
  const pausedState = pausedPhase === "module" ? checkpointQuestionTime(state, now, row.deadline_at_ms) : { ...state };
  pausedState.phase = "paused";
  pausedState.pausedPhase = pausedPhase;
  pausedState.remainingSeconds = pausedPhase === "module" && row.deadline_at_ms !== null ? Math.floor(Math.max(0, row.deadline_at_ms - now) / 1e3) : null;
  pausedState.questionTimingStartedAtMs = null;
  if (!await updateSectionLifecycle(env, row, token, pausedState, null, now))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before pausing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(updated, now));
}
async function resumeSectionExam(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Resume is unavailable for this Attempt.");
  const token = parseEditorToken(body2.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body2.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "paused" || state.pausedPhase !== "module" && state.pausedPhase !== "transition")
    return failure(409, "attempt_changed", "This Attempt is not paused.");
  const resumedState = {
    ...state,
    phase: state.pausedPhase,
    pausedPhase: null,
    remainingSeconds: null,
    questionTimingStartedAtMs: state.pausedPhase === "module" ? now : null
  };
  const deadlineAt = state.pausedPhase === "module" ? now + Number(state.remainingSeconds ?? 0) * 1e3 : null;
  if (!await updateSectionLifecycle(env, row, token, resumedState, deadlineAt, now))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before resuming.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  const current = await enforceSectionDeadline(env, updated, now);
  if (!current) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  return json(snapshot(current, now));
}
async function writeAttempt(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  const token = parseEditorToken(body2.editorToken);
  const expectedVersion = parseVersion(body2.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;
  const change = parseChange(body2.change, parseQuestions(row));
  if (!change) return failure(400, "invalid_attempt_change", "This Attempt change is invalid.");
  const originalState = parseState(row);
  if (row.kind === "section_exam") {
    if (originalState.phase !== "module")
      return failure(409, "attempt_changed", "Continue to the active Module before editing.");
    if (change.type === "calculator_state") {
      const config = JSON.parse(row.config_json);
      if (config.section !== "Math") return failure(400, "invalid_attempt_change", "Calculator state is only available in Math.");
    } else {
      const question3 = parseQuestions(row).find((item) => item.questionId === change.questionId);
      if (!question3 || question3.module !== Number(originalState.activeModule))
        return failure(400, "invalid_attempt_change", "Only the active Module can be changed.");
    }
  }
  const state = checkpointQuestionTime(originalState, now, row.deadline_at_ms);
  state.questionTimingStartedAtMs = now;
  const nextState = applyChange(state, change);
  if (!await updateEditorState(env, row, token, nextState, now))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), saveStatus: "saved" });
}
async function heartbeat(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  const token = parseEditorToken(body2.editorToken);
  const expectedVersion = parseVersion(body2.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;
  const state = parseState(row);
  if (row.kind === "section_exam" && state.phase !== "module")
    return failure(409, "attempt_changed", "A lease heartbeat is only accepted during a running Module.");
  const checkpointed = checkpointQuestionTime(state, now, row.deadline_at_ms);
  checkpointed.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, state_version = state_version + 1, editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)").bind(
    JSON.stringify(checkpointed),
    now + EDITOR_LEASE_MS,
    row.id,
    accountId,
    row.state_version,
    await sha2563(token),
    now,
    now
  ).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not renew editing. Try again.");
  if (result.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), saveStatus: "saved" });
}
async function takeover(env, accountId, attemptId, now) {
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.status !== "active") return failure(409, "attempt_changed", "This Attempt is no longer editable.");
  if (row.deadline_at_ms !== null && row.deadline_at_ms <= now)
    return failure(409, "attempt_expired", "The timed Attempt has ended.");
  const token = editorToken();
  const tokenHash = await sha2563(token);
  const state = parseState(row);
  const nextState = row.kind === "practice" ? checkpointQuestionTime(state, Math.min(now, row.editor_lease_expires_at_ms ?? now), row.deadline_at_ms) : state;
  if (row.kind === "practice") nextState.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, editor_token_hash = ?, editor_lease_expires_at_ms = ?, state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)").bind(JSON.stringify(nextState), tokenHash, now + EDITOR_LEASE_MS, row.id, accountId, row.state_version, now).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not transfer editing. Try again.");
  if (result.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before taking over.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), editorToken: token });
}
async function submitAttempt(request, env, accountId, attemptId, now) {
  const body2 = await readBody2(request);
  if (body2 instanceof Response) return body2;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind === "section_exam")
    return failure(409, "attempt_changed", "Finish both Section Exam Modules to complete this Attempt.");
  const token = parseEditorToken(body2.editorToken);
  const expectedVersion = parseVersion(body2.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;
  const questions2 = parseQuestions(row);
  const answerRows = await rows2(env.DB.prepare("SELECT question_id, accepted_answers_json FROM publication_answers WHERE revision_id = ?").bind(row.revision_id));
  const answers = new Map(answerRows.map((answer) => [answer.question_id, JSON.parse(answer.accepted_answers_json)]));
  if (questions2.some((question3) => !answers.has(question3.questionId)))
    return failure(503, "attempt_unavailable", "Whitebook could not grade this Attempt. Try again.");
  const state = checkpointQuestionTime(parseState(row), now, row.deadline_at_ms);
  const graded = questions2.map((question3) => {
    const acceptedAnswers = answers.get(question3.questionId);
    const response = state.responses[question3.questionId] ?? null;
    const correct = response !== null && acceptedAnswers.some((answer) => answer.trim().toLocaleLowerCase() === response.trim().toLocaleLowerCase());
    return { questionId: question3.questionId, response, acceptedAnswers, correct };
  });
  const resultData = {
    correctCount: graded.filter((question3) => question3.correct).length,
    questionCount: graded.length,
    questions: graded
  };
  const resultJson = JSON.stringify(resultData);
  const update = await env.DB.prepare("UPDATE learner_attempts SET status = 'completed', state_json = ?, completed_at_ms = ?, answers_exposed_at_ms = ?, result_json = ?, editor_token_hash = NULL, editor_lease_expires_at_ms = NULL, state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)").bind(JSON.stringify(state), now, now, resultJson, row.id, accountId, row.state_version, await sha2563(token), now, now).run();
  if (!update.success) return failure(503, "attempt_unavailable", "Whitebook could not submit this Attempt. Try again.");
  if (update.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before submitting.");
  const completed = await attemptRow(env, accountId, attemptId);
  if (!completed) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(completed, now), result: resultData });
}
async function getResults(env, accountId, attemptId, now) {
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.status !== "completed" || !row.result_json)
    return failure(409, "attempt_incomplete", "Results are available after you submit this Attempt.");
  await env.DB.prepare("UPDATE learner_attempts SET answers_exposed_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'completed' AND answers_exposed_at_ms IS NULL").bind(now, attemptId, accountId).run();
  return json({
    attemptId,
    status: row.status,
    completedAt: row.completed_at_ms,
    result: JSON.parse(row.result_json)
  });
}
async function markAssisted(env, accountId, attemptId, now) {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  if (row.status !== "active")
    return failure(409, "assisted_unavailable", "Only an active Attempt can become assisted.");
  const saved = await env.DB.prepare("UPDATE learner_attempts SET assisted_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' AND assisted_at_ms IS NULL").bind(now, attemptId, accountId).run();
  if (!saved.success) return failure(503, "attempt_unavailable", "Whitebook could not enable Assisted Practice. Try again.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), assisted: true });
}
function attemptRoute(request, env, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (path !== ROOT && !path.startsWith(ROOT + "/")) return null;
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method !== "GET") {
      const denied = await requireMutation(request, env, session2);
      if (denied) return denied;
    }
    const serverNow = now();
    if (request.method === "GET" && path === ROOT)
      return listAttempts(env, session2.account_id, serverNow);
    if (request.method === "POST" && path === ROOT)
      return createAttempt(request, env, session2.account_id, serverNow);
    const match = new RegExp("^/api/attempts/([0-9a-f-]{36})(?:/(start|write|heartbeat|takeover|submit|results|assisted|finish-module|continue|pause|resume))?$", "i").exec(path);
    if (!match) return failure(404, "not_found", "This Attempt action is unavailable.");
    const attemptId = match[1];
    if (request.method === "DELETE" && !match[2]) {
      const row = await attemptRow(env, session2.account_id, attemptId);
      if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
      const deleted = await env.DB.prepare("DELETE FROM learner_attempts WHERE id = ? AND account_id = ?").bind(attemptId, session2.account_id).run();
      if (!deleted.success) return failure(503, "attempt_unavailable", "The Attempt could not be deleted. Try again.");
      return json({ deleted: true, attemptId });
    }
    if (request.method === "GET" && !match[2])
      return getAttempt(env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "start")
      return startAttempt(env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "finish-module")
      return finishModule(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "continue")
      return continueSectionExam(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "pause")
      return pauseSectionExam(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "resume")
      return resumeSectionExam(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "write") return writeAttempt(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "heartbeat") return heartbeat(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "takeover") return takeover(env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "submit") return submitAttempt(request, env, session2.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "assisted") return markAssisted(env, session2.account_id, attemptId, serverNow);
    if (request.method === "GET" && match[2] === "results") return getResults(env, session2.account_id, attemptId, serverNow);
    return failure(404, "not_found", "This Attempt action is unavailable.");
  })();
}

// hosted/src/review.ts
var UUID = "[0-9a-f-]{36}";
var QUESTION2 = "[A-Za-z0-9_-]+";
async function body(request) {
  const raw = await request.text();
  if (raw.length > 8192) return failure(413, "request_too_large", "This review change is too large.");
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
  }
  return failure(400, "invalid_review", "This review change is invalid.");
}
async function attempt(env, accountId, id) {
  return env.DB.prepare("SELECT id, account_id, revision_id, status, questions_json, result_json, answers_exposed_at_ms FROM learner_attempts WHERE id = ? AND account_id = ?").bind(id, accountId).first();
}
function resultQuestion(row, questionId) {
  if (row.status !== "completed" || !row.result_json) return null;
  return JSON.parse(row.result_json).questions.find((item) => item.questionId === questionId) ?? null;
}
async function review(env, accountId, id) {
  return env.DB.prepare("SELECT id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, retry_response, hint_used, revealed_at_ms, mistake_label, created_at_ms, updated_at_ms FROM guided_reviews WHERE id = ? AND account_id = ?").bind(id, accountId).first();
}
async function help(env, revisionId, questionId) {
  return env.DB.prepare("SELECT reviewed_hint, reviewed_explanation FROM publication_review_help WHERE revision_id = ? AND question_id = ?").bind(revisionId, questionId).first();
}
async function details(env, item) {
  const source = await attempt(env, item.account_id, item.attempt_id);
  const original = source && resultQuestion(source, item.question_id);
  if (!source || !original) return failure(404, "not_found", "This completed review is unavailable.");
  const reviewed = await help(env, item.revision_id, item.question_id);
  const revealed = item.revealed_at_ms !== null;
  const notes2 = revealed ? (await env.DB.prepare("SELECT id, body, created_at_ms, updated_at_ms FROM study_notes WHERE account_id = ? AND revision_id = ? AND question_id = ? ORDER BY created_at_ms, id").bind(item.account_id, item.revision_id, item.question_id).all()).results : [];
  const retryCorrect = revealed && item.retry_response !== null ? original.acceptedAnswers.some((answer) => answer.trim().toLocaleLowerCase() === item.retry_response.trim().toLocaleLowerCase()) : null;
  return json({
    reviewId: item.id,
    attemptId: item.attempt_id,
    revisionId: item.revision_id,
    questionId: item.question_id,
    priorAnswerExposure: item.prior_answer_exposure,
    hintAvailable: !!reviewed?.reviewed_hint,
    hintUsed: !!item.hint_used,
    revealed,
    mistakeLabel: item.mistake_label,
    ...revealed ? {
      originalResponse: original.response,
      retryResponse: item.retry_response,
      acceptedAnswers: original.acceptedAnswers,
      retryCorrect,
      explanation: reviewed?.reviewed_explanation ?? null,
      notes: notes2
    } : {}
  });
}
async function overview2(env, accountId, attemptId) {
  const source = await attempt(env, accountId, attemptId);
  if (!source) return failure(404, "not_found", "This Attempt is unavailable.");
  if (source.status !== "completed" || !source.result_json)
    return failure(409, "attempt_incomplete", "Review is available after an Attempt is complete.");
  const result = JSON.parse(source.result_json);
  const links = new Map(JSON.parse(source.questions_json).map((link) => [link.questionId, link]));
  return json({
    attemptId,
    revisionId: source.revision_id,
    correctCount: result.correctCount,
    questionCount: result.questionCount,
    questions: result.questions.map((item) => {
      const link = links.get(item.questionId);
      return {
        questionId: item.questionId,
        section: link?.section,
        module: link?.module,
        questionNumber: link?.questionNumber,
        status: item.correct ? "correct" : !item.response?.trim() ? "unanswered" : "incorrect"
      };
    })
  });
}
async function start2(env, accountId, attemptId, questionId, now) {
  const source = await attempt(env, accountId, attemptId);
  if (!source) return failure(404, "not_found", "This Attempt is unavailable.");
  const original = resultQuestion(source, questionId);
  if (!original || original.correct) return failure(409, "review_unavailable", "Choose a wrong or unanswered question in a completed Attempt.");
  const previous = await env.DB.prepare("SELECT revealed_at_ms FROM guided_reviews WHERE account_id = ? AND revision_id = ? AND question_id = ? AND revealed_at_ms IS NOT NULL LIMIT 1").bind(accountId, source.revision_id, questionId).first();
  const exposedAttempts = (await env.DB.prepare("SELECT result_json FROM learner_attempts WHERE account_id = ? AND revision_id = ? AND answers_exposed_at_ms IS NOT NULL AND status = 'completed'").bind(accountId, source.revision_id).all()).results;
  const exposedElsewhere = exposedAttempts.some((row) => JSON.parse(row.result_json).questions.some((item) => item.questionId === questionId));
  const exposure = source.answers_exposed_at_ms != null || previous || exposedElsewhere ? "seen" : "possible";
  const id = crypto.randomUUID();
  const saved = await env.DB.prepare("INSERT INTO guided_reviews (id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, accountId, attemptId, source.revision_id, questionId, exposure, now, now).run();
  if (!saved.success) return failure(503, "save_failed", "The guided review could not be started.");
  return details(env, {
    id,
    account_id: accountId,
    attempt_id: attemptId,
    revision_id: source.revision_id,
    question_id: questionId,
    prior_answer_exposure: exposure,
    retry_response: null,
    hint_used: 0,
    revealed_at_ms: null,
    mistake_label: null,
    created_at_ms: now,
    updated_at_ms: now
  });
}
async function changeReview(request, env, item, action, now) {
  if (action === "hint") {
    if (item.revealed_at_ms !== null) return failure(409, "review_revealed", "This answer has already been revealed.");
    const reviewed = await help(env, item.revision_id, item.question_id);
    if (!reviewed?.reviewed_hint) return failure(404, "hint_unavailable", "No reviewed hint is available for this question.");
    const saved = await env.DB.prepare("UPDATE guided_reviews SET hint_used = 1, updated_at_ms = ? WHERE id = ? AND account_id = ? AND revealed_at_ms IS NULL").bind(now, item.id, item.account_id).run();
    if (saved.meta.changes !== 1) return failure(409, "review_changed", "This review changed. Open it again.");
    return json({ hint: reviewed.reviewed_hint });
  }
  if (action === "retry" || action === "reveal") {
    if (item.revealed_at_ms !== null) return failure(409, "review_revealed", "This answer has already been revealed.");
    let retry = null;
    if (action === "retry") {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (typeof input.response !== "string" || !input.response.trim() || input.response.length > 4096)
        return failure(400, "invalid_retry", "Enter a retry response before checking it.");
      retry = input.response.trim();
      const source = await attempt(env, item.account_id, item.attempt_id);
      const link = source && JSON.parse(source.questions_json).find((q) => q.questionId === item.question_id);
      if (!link) return failure(404, "not_found", "This question is unavailable.");
      if (link.responseType === "multiple_choice" && !link.choiceIds.includes(retry))
        return failure(400, "invalid_retry", "Choose one of this question's answers.");
    }
    const saved = await env.DB.prepare("UPDATE guided_reviews SET retry_response = ?, revealed_at_ms = ?, updated_at_ms = ? WHERE id = ? AND account_id = ? AND revealed_at_ms IS NULL").bind(retry, now, now, item.id, item.account_id).run();
    if (saved.meta.changes !== 1) return failure(409, "review_changed", "This review changed. Open it again.");
    return details(env, { ...item, retry_response: retry, revealed_at_ms: now, updated_at_ms: now });
  }
  if (action === "label") {
    if (item.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal the answer before saving a mistake label.");
    const input = await body(request);
    if (input instanceof Response) return input;
    if (input.label !== null && (typeof input.label !== "string" || input.label.length > 120))
      return failure(400, "invalid_label", "Keep the mistake label under 120 characters.");
    const label = typeof input.label === "string" ? input.label.trim() || null : null;
    const saved = await env.DB.prepare("UPDATE guided_reviews SET mistake_label = ?, updated_at_ms = ? WHERE id = ? AND account_id = ?").bind(label, now, item.id, item.account_id).run();
    if (!saved.success) return failure(503, "save_failed", "The mistake label was not saved.");
    return details(env, { ...item, mistake_label: label, updated_at_ms: now });
  }
  return failure(404, "not_found", "This review action is unavailable.");
}
async function notes(request, env, item, noteId, now) {
  if (item.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal the answer before opening Study Notes.");
  if (request.method === "POST" || request.method === "PATCH") {
    const input = await body(request);
    if (input instanceof Response) return input;
    if (typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 4e3)
      return failure(400, "invalid_note", "Write a Study Note of at most 4000 characters.");
    const text = input.body.trim();
    if (request.method === "POST" && !noteId) {
      const id = crypto.randomUUID();
      const saved = await env.DB.prepare("INSERT INTO study_notes (id, account_id, revision_id, question_id, body, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, item.account_id, item.revision_id, item.question_id, text, now, now).run();
      if (!saved.success) return failure(503, "save_failed", "The Study Note was not saved.");
      return json({ note: { id, body: text, created_at_ms: now, updated_at_ms: now } }, 201);
    }
    if (request.method === "PATCH" && noteId) {
      const saved = await env.DB.prepare("UPDATE study_notes SET body = ?, updated_at_ms = ? WHERE id = ? AND account_id = ? AND revision_id = ? AND question_id = ?").bind(text, now, noteId, item.account_id, item.revision_id, item.question_id).run();
      if (saved.meta.changes !== 1) return failure(404, "not_found", "This Study Note is unavailable.");
      return json({ note: { id: noteId, body: text, updated_at_ms: now } });
    }
  }
  if (request.method === "DELETE" && noteId) {
    const removed = await env.DB.prepare("DELETE FROM study_notes WHERE id = ? AND account_id = ? AND revision_id = ? AND question_id = ?").bind(noteId, item.account_id, item.revision_id, item.question_id).run();
    if (removed.meta.changes !== 1) return failure(404, "not_found", "This Study Note is unavailable.");
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  }
  if (request.method === "GET" && !noteId) return details(env, item);
  return failure(404, "not_found", "This Study Note action is unavailable.");
}
function reviewRoute(request, env, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/review/")) return null;
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to open private review.");
    if (request.method !== "GET") {
      const denied = await requireMutation(request, env, session2);
      if (denied) return denied;
    }
    const activeExam = await env.DB.prepare("SELECT id FROM learner_attempts WHERE account_id = ? AND kind = 'section_exam' AND status = 'active' LIMIT 1").bind(session2.account_id).first();
    if (activeExam) return failure(409, "active_section_exam", "Finish the active Section Exam before opening guided review or Study Notes.");
    const attemptMatch = new RegExp(`^/api/review/attempts/(${UUID})(?:/questions/(${QUESTION2}))?$`, "i").exec(path);
    if (attemptMatch) {
      if (request.method === "GET" && !attemptMatch[2]) return overview2(env, session2.account_id, attemptMatch[1]);
      if (request.method === "POST" && attemptMatch[2]) return start2(env, session2.account_id, attemptMatch[1], attemptMatch[2], now());
      return failure(404, "not_found", "This review action is unavailable.");
    }
    const match = new RegExp(`^/api/review/(${UUID})(?:/(retry|reveal|hint|label|notes)(?:/(${UUID}))?)?$`, "i").exec(path);
    if (!match) return failure(404, "not_found", "This review is unavailable.");
    const item = await review(env, session2.account_id, match[1]);
    if (!item) return failure(404, "not_found", "This review is unavailable.");
    if (request.method === "GET" && !match[2]) return details(env, item);
    if (match[2] === "notes") return notes(request, env, item, match[3], now());
    if (request.method === "POST" && ["retry", "reveal", "hint", "label"].includes(match[2] ?? ""))
      return changeReview(request, env, item, match[2], now());
    return failure(404, "not_found", "This review action is unavailable.");
  })();
}

// hosted/src/mathTools.ts
var REFERENCE_ASSET_PATH = "/assets/reference-sheet.png";
var REFERENCE_API_PATH = "/api/math/reference-sheet.png";
var CALCULATOR_CONFIG_PATH = "/api/math/calculator-config";
var CALCULATOR_FRAME_PATH = "/app/calculator-frame";
var BRIDGE = `
let calculator;
const checks={scriptLoaded:false,constructorAvailable:false,instanceCreated:false,stateReadable:false,usableSize:false};
const send=(type,payload)=>parent.postMessage({whitebookCalculator:true,type,payload},'*');
window.addEventListener('message',async(event)=>{
  if(event.source!==parent||event.data?.type!=='initialize'||calculator)return;
  const {scriptUrl,options,state}=event.data;
  if(typeof scriptUrl!=='string'||!/^https://www\\.desmos\\.com/api/v1\\.12/calculator\\.js\\?apiKey=[A-Za-z0-9%_.~-]+$/.test(scriptUrl))return;
  try{
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timeout=setTimeout(()=>reject(new Error('timeout')),20000);
      script.onload=()=>{clearTimeout(timeout);resolve()};
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('load'))};
      script.src=scriptUrl;document.head.append(script);
    });
    checks.scriptLoaded=true;
    checks.constructorAvailable=typeof Desmos?.GraphingCalculator==='function';
    calculator=Desmos.GraphingCalculator(document.getElementById('calculator'),options);
    checks.instanceCreated=!!calculator;
    if(state)calculator.setState(state);
    checks.stateReadable=!!calculator.getState();
    const rect=document.getElementById('calculator').getBoundingClientRect();
    checks.usableSize=rect.width>=240&&rect.height>=200;
    calculator.observeEvent('change',()=>send('state',calculator.getState()));
    send('ready',checks);send('state',calculator.getState());
  }catch{send('ready',checks)}
});`;
function privateHeaders(extra = {}) {
  const headers = new Headers(noStore);
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return headers;
}
function calculatorFrame() {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#calculator{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="calculator"></div><script nonce="${nonce}">${BRIDGE}</script></body></html>`;
  const headers = privateHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://www.desmos.com; style-src 'unsafe-inline' https://www.desmos.com; connect-src https://*.desmos.com wss://*.desmos.com; img-src 'self' data: blob: https://*.desmos.com; font-src 'self' data: https://*.desmos.com; frame-src https://*.desmos.com; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`
  });
  return new Response(html, { status: 200, headers });
}
async function calculatorConfig(request, env) {
  if (!await currentSession(request, env))
    return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const key2 = env.DESMOS_API_KEY?.trim();
  if (!key2) return json({ configured: false, scriptUrl: null });
  return json({
    configured: true,
    scriptUrl: `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(key2)}`
  });
}
async function referenceSheet(request, env) {
  if (!await currentSession(request, env))
    return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const asset = await env.ASSETS.fetch(new Request(new URL(REFERENCE_ASSET_PATH, request.url), { method: "GET" }));
  if (!asset.ok) return failure(503, "math_resource_unavailable", "The Math Reference Sheet is unavailable. Try again.");
  return new Response(asset.body, {
    status: 200,
    headers: privateHeaders({ "Content-Type": "image/png", "Cross-Origin-Resource-Policy": "same-origin" })
  });
}
function mathToolsRoute(request, env) {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === CALCULATOR_FRAME_PATH) return Promise.resolve(calculatorFrame());
  if (request.method === "GET" && pathname === CALCULATOR_CONFIG_PATH) return calculatorConfig(request, env);
  if (request.method === "GET" && pathname === REFERENCE_API_PATH) return referenceSheet(request, env);
  return null;
}

// hosted/src/progress.ts
var CATEGORY_DOMAINS = {
  "Reading and Writing": {
    "Word in Context": "Craft and Structure",
    "Main Idea": "Information and Ideas",
    "Text Structure": "Craft and Structure",
    "Command of Evidence": "Information and Ideas",
    "Inference": "Information and Ideas",
    "Cross Text": "Craft and Structure",
    "Grammar": "Standard English Conventions",
    "Transition": "Expression of Ideas",
    "Rhetorical Synthesis": "Expression of Ideas",
    "Details": "Information and Ideas"
  },
  Math: {
    Algebra: "Algebra",
    "Advanced Math": "Advanced Math",
    "Problem-Solving and Data Analysis": "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry": "Geometry and Trigonometry"
  }
};
function finiteTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function groupEvidence(items) {
  const ordered = [...items].sort((a, b) => b.completedAt - a.completedAt || a.attemptId.localeCompare(b.attemptId));
  const correct = items.filter((item) => item.correct).length;
  const unanswered = items.filter((item) => item.unanswered).length;
  const timed = items.filter((item) => item.timeMs !== null);
  const attemptIds = [...new Set(ordered.map((item) => item.attemptId))];
  const recent = ordered.filter((item) => item.attemptId === attemptIds[0]);
  const previous = ordered.filter((item) => item.attemptId === attemptIds[1]);
  const recentAccuracy = recent.length >= 5 && previous.length >= 5 ? recent.filter((item) => item.correct).length / recent.length * 100 : null;
  const previousAccuracy = recentAccuracy !== null ? previous.filter((item) => item.correct).length / previous.length * 100 : null;
  const shift = recentAccuracy !== null && previousAccuracy !== null ? recentAccuracy - previousAccuracy : null;
  const conflicting = shift !== null && Math.abs(shift) >= 25;
  const tentativeReasons = [
    ...items.length < 10 ? ["Fewer than 10 graded questions"] : [],
    ...attemptIds.length < 2 ? ["Evidence comes from one completed Attempt"] : [],
    ...attemptIds.length >= 2 && (recent.length < 5 || previous.length < 5) ? ["Fewer than 5 questions in each of the latest two Attempts"] : [],
    ...conflicting ? ["Recent accuracy differs from earlier evidence"] : []
  ];
  return {
    sampleSize: items.length,
    attemptCount: attemptIds.length,
    correct,
    incorrect: items.length - correct - unanswered,
    unanswered,
    rawAccuracy: Math.round(correct / items.length * 1e3) / 10,
    averageTimeSeconds: timed.length ? Math.round(timed.reduce((sum, item) => sum + item.timeMs, 0) / timed.length / 100) / 10 : null,
    timeSampleSize: timed.length,
    latestAt: ordered[0].completedAt,
    recentTrend: shift === null ? "insufficient" : shift > 0 ? "up" : shift < 0 ? "down" : "steady",
    recentAccuracy,
    previousAccuracy,
    tentative: tentativeReasons.length > 0,
    tentativeReasons
  };
}
function summarizeProgress(attempts, categories) {
  const metadata = new Map(categories.map((row) => [`${row.revision_id}\0${row.question_id}`, row]));
  const evidence = [];
  let excludedAssisted = 0;
  for (const attempt2 of attempts) {
    if (!["practice", "section_exam"].includes(attempt2.kind)) continue;
    const links = JSON.parse(attempt2.questions_json);
    const grades = JSON.parse(attempt2.result_json);
    if (attempt2.assisted_at_ms != null) {
      excludedAssisted += grades.questions.length;
      continue;
    }
    const state = JSON.parse(attempt2.state_json);
    const byId = new Map(links.map((item) => [item.questionId, item]));
    const assisted = new Set(state.assistedQuestionIds ?? []);
    for (const grade of grades.questions) {
      if (grade.assisted || assisted.has(grade.questionId)) {
        excludedAssisted++;
        continue;
      }
      const link = byId.get(grade.questionId);
      if (!link) continue;
      const row = metadata.get(`${attempt2.revision_id}\0${grade.questionId}`);
      const category = row?.section === link.section && row.category ? row.category : "Uncategorized";
      evidence.push({
        section: link.section,
        category,
        domain: CATEGORY_DOMAINS[link.section]?.[category] ?? null,
        correct: grade.correct,
        unanswered: !grade.response?.trim(),
        timeMs: finiteTime(state.questionElapsedMs?.[grade.questionId]),
        completedAt: attempt2.completed_at_ms,
        attemptId: attempt2.id
      });
    }
  }
  function grouped(key2, name, filter = (_item) => true) {
    const buckets = /* @__PURE__ */ new Map();
    for (const item of evidence.filter(filter)) {
      const id = key2(item);
      const bucket = buckets.get(id) ?? [];
      bucket.push(item);
      buckets.set(id, bucket);
    }
    return [...buckets.values()].map((items) => ({ ...name(items[0]), ...groupEvidence(items) }));
  }
  const sections = grouped((item) => item.section, (item) => ({ section: item.section }));
  const groupedCategory = (item) => `${item.section}\0${item.category}`;
  const categoryName = (item) => ({ section: item.section, category: item.category });
  const categoryRows = grouped(groupedCategory, categoryName);
  const domains = grouped(
    (item) => `${item.section}\0${item.domain}`,
    (item) => ({ section: item.section, domain: item.domain }),
    (item) => item.domain !== null
  );
  const unmapped = grouped(groupedCategory, categoryName, (item) => item.domain === null);
  return {
    completedAttempts: attempts.filter((attempt2) => ["practice", "section_exam"].includes(attempt2.kind)).length,
    excludedAssisted,
    sections,
    categories: categoryRows,
    domains,
    unmapped
  };
}
function progressRoute(request, env) {
  if (new URL(request.url).pathname !== "/api/account/progress") return null;
  if (request.method !== "GET") return Promise.resolve(failure(404, "not_found", "This progress action is unavailable."));
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to see your progress evidence.");
    const result = await env.DB.prepare("SELECT id, revision_id, kind, completed_at_ms, questions_json, result_json, state_json, assisted_at_ms FROM learner_attempts WHERE account_id = ? AND status = 'completed' AND result_json IS NOT NULL ORDER BY completed_at_ms DESC").bind(session2.account_id).all();
    const attempts = result.results;
    const revisions = [...new Set(attempts.map((item) => item.revision_id))];
    const categories = revisions.length ? (await env.DB.prepare(
      `SELECT pq.revision_id, pq.question_id, pq.section, pc.category FROM publication_questions pq LEFT JOIN publication_question_categories pc ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id WHERE pq.revision_id IN (${revisions.map(() => "?").join(",")})`
    ).bind(...revisions).all()).results : [];
    return json(summarizeProgress(attempts, categories));
  })();
}

// hosted/src/plan.ts
var YMD = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  try {
    return addCalendarDays(value, 0) === value;
  } catch {
    return false;
  }
}
function weekday(date) {
  return (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
}
function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value;
  if (Object.keys(item).some((key2) => !["primaryDate", "studyDays", "restDays", "dailyMinutes", "officialScoreGoal"].includes(key2))) return null;
  const days = (v) => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && new Set(v).size === v.length;
  if (!validDate(item.primaryDate) || !days(item.studyDays) || !days(item.restDays) || !item.studyDays.length || (/* @__PURE__ */ new Set([...item.studyDays, ...item.restDays])).size !== 7 || item.studyDays.length + item.restDays.length !== 7 || !Number.isInteger(item.dailyMinutes) || item.dailyMinutes < 10 || item.dailyMinutes > 240 || !(item.officialScoreGoal === null || Number.isInteger(item.officialScoreGoal) && item.officialScoreGoal >= 400 && item.officialScoreGoal <= 1600 && item.officialScoreGoal % 10 === 0)) return null;
  return item;
}
function buildPlan(today2, settings, input) {
  const tasks = [];
  const remaining = /* @__PURE__ */ new Map();
  const dates = [];
  for (let date = today2; date < settings.primaryDate; date = addCalendarDays(date, 1)) {
    if (settings.studyDays.includes(weekday(date))) {
      dates.push(date);
      remaining.set(date, settings.dailyMinutes);
    }
  }
  const place = (task, earliest = today2) => {
    const date = dates.find((day2) => day2 >= earliest && (remaining.get(day2) ?? 0) >= task.minutes);
    if (!date) return false;
    tasks.push({ ...task, date });
    remaining.set(date, remaining.get(date) - task.minutes);
    return true;
  };
  if (input.dueCards > 0) {
    const minutes = Math.min(20, settings.dailyMinutes);
    place({
      kind: "cards",
      title: `Review up to ${Math.min(input.dueCards, minutes)} due cards`,
      minutes,
      action: { area: "cards" },
      evidenceCount: input.dueCards,
      tentative: false,
      explanation: `${input.dueCards} cards are due as of this plan build. Review a manageable set and check the live due queue when you start.`
    });
  }
  for (const missed of input.missed.slice(0, 12)) place({
    kind: "review",
    title: `Review missed ${missed.section} question ${missed.questionNumber}`,
    minutes: 10,
    action: { area: "history", attemptId: missed.attemptId, questionId: missed.questionId },
    evidenceCount: 1,
    tentative: true,
    explanation: `One incorrect or unanswered response in a completed Attempt.${missed.reviewOutcome === "unfinished" ? " A guided review was started but not finished." : missed.reviewOutcome === "retry-incorrect" ? " The latest guided retry was still incorrect." : missed.reviewOutcome === "revealed-without-retry" ? " The answer was revealed without a successful retry." : ""} Guided retry does not change Raw Accuracy.`
  });
  if (input.practice.length) {
    const weeks = /* @__PURE__ */ new Map();
    for (const date of dates) {
      const monday = addCalendarDays(date, -((weekday(date) + 6) % 7));
      if (!weeks.has(monday)) weeks.set(monday, date);
    }
    let index = 0;
    for (const earliest of weeks.values()) {
      const activity = input.practice[index++ % input.practice.length];
      place({
        kind: "practice",
        title: `Practice ${activity.section} \xB7 ${activity.packageTitle}`,
        minutes: Math.min(25, settings.dailyMinutes),
        action: { area: "practice", revisionId: activity.revisionId, section: activity.section },
        evidenceCount: activity.evidenceCount,
        tentative: activity.tentative || activity.evidenceCount === 0,
        explanation: activity.evidenceCount ? `${activity.evidenceCount} unassisted graded questions in this Section; Raw Accuracy ${activity.rawAccuracy}%. This is Whitebook practice evidence, not an SAT score.${activity.officialEvidence ? ` Separately: ${activity.officialEvidence}` : ""}` : `Baseline Practice from an available Test Package; no unassisted Section evidence yet. ${activity.officialEvidence ?? "Start here to establish a baseline."}`
      }, earliest);
    }
  }
  return tasks.sort((a, b) => a.date.localeCompare(b.date) || { cards: 0, review: 1, practice: 2 }[a.kind] - { cards: 0, review: 1, practice: 2 }[b.kind]);
}
var TASK_COLUMNS = "id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, updated_at_ms";
var VERSION_COLUMNS = "id, version, primary_date, settings_json, source_json, created_at_ms";
function taskJson(row) {
  return {
    id: row.id,
    versionId: row.version_id,
    date: row.scheduled_date,
    kind: row.kind,
    title: row.title,
    minutes: row.estimated_minutes,
    action: JSON.parse(row.action_json),
    evidenceCount: row.evidence_count,
    tentative: !!row.tentative,
    explanation: row.explanation,
    status: row.status,
    revision: row.revision
  };
}
function versionJson(row) {
  return {
    id: row.id,
    version: row.version,
    primaryDate: row.primary_date,
    settings: JSON.parse(row.settings_json),
    source: JSON.parse(row.source_json),
    createdAt: row.created_at_ms
  };
}
async function all(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args).all()).results;
}
async function currentVersion(env, accountId) {
  return env.DB.prepare(`SELECT ${VERSION_COLUMNS} FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1`).bind(accountId).first();
}
function missedQuestions(attemptRows, reviews, available) {
  const latestReview = /* @__PURE__ */ new Map();
  for (const row of [...reviews].sort((a, b) => b.updated_at_ms - a.updated_at_ms)) {
    const key2 = `${row.attempt_id}\0${row.question_id}`;
    if (!latestReview.has(key2)) latestReview.set(key2, row);
  }
  const assigned = /* @__PURE__ */ new Set();
  const missed = [];
  for (const row of attemptRows) {
    if (!available.has(row.revision_id)) continue;
    const links = new Map(JSON.parse(row.questions_json).map((item) => [item.questionId, item]));
    for (const grade of JSON.parse(row.result_json).questions) {
      const link = links.get(grade.questionId);
      const identity = `${row.revision_id}\0${grade.questionId}`;
      if (!link || assigned.has(identity)) continue;
      assigned.add(identity);
      if (grade.correct) continue;
      const review2 = latestReview.get(`${row.id}\0${grade.questionId}`);
      const retryCorrect = review2?.revealed_at_ms != null && review2.retry_response !== null && grade.acceptedAnswers?.some((answer) => answer.trim().toLocaleLowerCase() === review2.retry_response.trim().toLocaleLowerCase());
      if (retryCorrect) continue;
      missed.push({
        attemptId: row.id,
        questionId: grade.questionId,
        section: link.section,
        questionNumber: link.questionNumber,
        ...review2 ? { reviewOutcome: review2.revealed_at_ms === null ? "unfinished" : review2.retry_response === null ? "revealed-without-retry" : "retry-incorrect" } : {}
      });
    }
  }
  return missed;
}
async function planContext(request, env, accountId, now) {
  const [account, dates, scores, attempts, reviewed, packages] = await Promise.all([
    env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(accountId).first(),
    env.DB.prepare("SELECT test_date FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1").bind(accountId).first(),
    env.DB.prepare("SELECT id, administration_date, reading_writing_score, math_score, updated_at FROM official_sat_results WHERE account_id = ? ORDER BY updated_at DESC").bind(accountId).all(),
    env.DB.prepare("SELECT id, revision_id, kind, completed_at_ms, questions_json, result_json, state_json FROM learner_attempts WHERE account_id = ? AND status = 'completed' AND result_json IS NOT NULL ORDER BY completed_at_ms DESC").bind(accountId).all(),
    env.DB.prepare("SELECT attempt_id, question_id, retry_response, revealed_at_ms, updated_at_ms FROM guided_reviews WHERE account_id = ?").bind(accountId).all(),
    env.DB.prepare(`SELECT p.id AS revision_id, p.title, q.section, COUNT(*) AS question_count FROM package_revisions p JOIN publication_questions q ON q.revision_id = p.id
      WHERE EXISTS (SELECT 1 FROM active_publication a JOIN publication_release_revisions r ON r.release_id = a.release_id AND r.revision_id = p.id)
      OR EXISTS (SELECT 1 FROM private_revision_entitlements e WHERE e.revision_id = p.id AND e.account_id = ?)
      GROUP BY p.id, p.title, q.section ORDER BY p.title, q.section`).bind(accountId).all()
  ]);
  const zone = account?.time_zone && isValidZone(account.time_zone) ? account.time_zone : "UTC";
  const today2 = localCalendarDate(now, zone);
  const cardRequest = new Request(new URL(`/api/cards/study?zone=${encodeURIComponent(zone)}`, request.url), { headers: request.headers });
  const cardResponse = await studyRoute(cardRequest, env, () => now);
  if (!cardResponse?.ok) throw new Error("Due cards could not be loaded for planning");
  const dueCards2 = (await cardResponse.json()).totalDue;
  const attemptRows = attempts.results;
  const revisions = [...new Set(attemptRows.map((item) => item.revision_id))];
  const categories = revisions.length ? await all(
    env,
    `SELECT pq.revision_id, pq.question_id, pq.section, pc.category FROM publication_questions pq LEFT JOIN publication_question_categories pc
      ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id WHERE pq.revision_id IN (${revisions.map(() => "?").join(",")})`,
    ...revisions
  ) : [];
  const progress = summarizeProgress(attemptRows, categories);
  const available = new Set(packages.results.map((item) => item.revision_id));
  const missed = missedQuestions(attemptRows, reviewed.results, available);
  const latestScore = scores.results[0];
  const practice = packages.results.map((item) => {
    const evidence = progress.sections.find((section) => section.section === item.section);
    const score = item.section === "Math" ? latestScore?.math_score : latestScore?.reading_writing_score;
    return {
      revisionId: item.revision_id,
      packageTitle: item.title,
      section: item.section,
      questionCount: Number(item.question_count),
      evidenceCount: evidence?.sampleSize ?? 0,
      rawAccuracy: evidence?.rawAccuracy ?? null,
      tentative: evidence?.tentative ?? true,
      officialEvidence: score === void 0 ? void 0 : `Learner-entered Official SAT ${item.section} score ${score}; no SAT point gain is promised.`
    };
  }).sort((a, b) => (a.evidenceCount ? a.rawAccuracy : 101) - (b.evidenceCount ? b.rawAccuracy : 101) || (latestScore ? (a.section === "Math" ? latestScore.math_score : latestScore.reading_writing_score) - (b.section === "Math" ? latestScore.math_score : latestScore.reading_writing_score) : 0) || a.packageTitle.localeCompare(b.packageTitle));
  const officialResultCount = scores.results.length;
  const source = {
    primaryDate: dates?.test_date ?? null,
    attemptCount: attemptRows.length,
    latestAttempt: attemptRows[0]?.id ?? null,
    latestAttemptAt: attemptRows[0]?.completed_at_ms ?? null,
    officialResultCount,
    latestOfficialResult: scores.results[0] ?? null,
    reviewCount: reviewed.results.length,
    latestReviewAt: Math.max(0, ...reviewed.results.map((r) => r.updated_at_ms)),
    dueCards: dueCards2,
    availableActivities: practice.map((activity) => `${activity.revisionId}:${activity.section}`)
  };
  return { today: today2, zone, primaryDate: dates?.test_date ?? null, inputs: { dueCards: dueCards2, missed, practice, officialResultCount }, source };
}
async function show3(request, env, session2, now) {
  const [versions, ctx] = await Promise.all([
    all(env, `SELECT ${VERSION_COLUMNS} FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC`, session2.account_id),
    planContext(request, env, session2.account_id, now)
  ]);
  const requested = new URL(request.url).searchParams.get("version");
  if (requested && !versions.some((v) => v.id === requested)) return failure(404, "not_found", "This plan version is unavailable.");
  const selected = versions.find((v) => v.id === requested) ?? versions[0];
  const tasks = selected ? await all(env, `SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE account_id = ? AND version_id = ? ORDER BY scheduled_date, rowid`, session2.account_id, selected.id) : [];
  const completedHistory = await env.DB.prepare("SELECT COUNT(*) AS count FROM study_plan_tasks WHERE account_id = ? AND status = 'done'").bind(session2.account_id).first();
  const overdue = selected?.id === versions[0]?.id ? tasks.filter((t) => t.status === "pending" && t.scheduled_date < ctx.today) : [];
  return json({
    today: ctx.today,
    zone: ctx.zone,
    primaryDate: ctx.primaryDate,
    baseline: ctx.source.attemptCount === 0 && ctx.source.officialResultCount === 0,
    evidence: { dueCards: ctx.inputs.dueCards, missedQuestions: ctx.inputs.missed.length, completedAttempts: ctx.source.attemptCount, officialResultCount: ctx.source.officialResultCount },
    stale: !!versions[0] && JSON.stringify(JSON.parse(versions[0].source_json)) !== JSON.stringify(ctx.source),
    versions: versions.map(versionJson),
    selected: selected ? versionJson(selected) : null,
    tasks: tasks.map(taskJson),
    completedHistory: Number(completedHistory?.count ?? 0),
    catchUp: { overdueCount: overdue.length, choices: ["Move one task to the next available study day", "Skip a task that no longer helps", "Rebuild from current evidence"] }
  });
}
async function readBody3(request) {
  const raw = await request.text();
  if (raw.length > 8192) return failure(413, "too_large", "This plan change is too large.");
  try {
    const body2 = JSON.parse(raw);
    return body2 && typeof body2 === "object" && !Array.isArray(body2) ? body2 : failure(400, "invalid_plan", "Send the plan change as an object.");
  } catch {
    return failure(400, "invalid_plan", "Send the plan change as JSON.");
  }
}
async function rebuild(request, env, session2, now) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const body2 = await readBody3(request);
  if (body2 instanceof Response) return body2;
  if (Object.keys(body2).some((key2) => !["settings", "expectedVersionId"].includes(key2)) || !(body2.expectedVersionId === null || typeof body2.expectedVersionId === "string"))
    return failure(400, "invalid_plan", "Open the latest plan before rebuilding.");
  const settings = validateSettings(body2.settings);
  if (!settings) return failure(400, "invalid_settings", "Choose a study day, rest days, 10\u2013240 daily minutes, and a valid optional official-score goal.");
  const [ctx, previous] = await Promise.all([planContext(request, env, session2.account_id, now), currentVersion(env, session2.account_id)]);
  if (settings.primaryDate !== ctx.primaryDate || settings.primaryDate <= ctx.today)
    return failure(400, "invalid_date", "Choose a future primary SAT Weekend date on the Dashboard first.");
  if ((previous?.id ?? null) !== body2.expectedVersionId) return failure(409, "plan_changed", "A newer plan exists. Reload before rebuilding.");
  const completedReviews = await all(
    env,
    "SELECT action_json FROM study_plan_tasks WHERE account_id = ? AND kind = 'review' AND status = 'done'",
    session2.account_id
  );
  const completedKeys = new Set(completedReviews.map((row) => {
    const action = JSON.parse(row.action_json);
    return `${action.attemptId}\0${action.questionId}`;
  }));
  const generated = buildPlan(ctx.today, settings, {
    ...ctx.inputs,
    missed: ctx.inputs.missed.filter((item) => !completedKeys.has(`${item.attemptId}\0${item.questionId}`))
  });
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare(`INSERT INTO study_plan_versions (id, account_id, version, primary_date, settings_json, source_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, session2.account_id, (previous?.version ?? 0) + 1, settings.primaryDate, JSON.stringify(settings), JSON.stringify(ctx.source), now)];
  if (generated.length) {
    const rowsJson = JSON.stringify(generated.map((task) => ({ ...task, id: crypto.randomUUID() })));
    statements.push(env.DB.prepare(`INSERT INTO study_plan_tasks
    (id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, account_id, updated_at_ms)
    SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.date'), json_extract(j.value, '$.kind'),
      json_extract(j.value, '$.title'), json_extract(j.value, '$.minutes'), json_extract(j.value, '$.action'),
      json_extract(j.value, '$.evidenceCount'), json_extract(j.value, '$.tentative'), json_extract(j.value, '$.explanation'),
      'pending', 0, ?, ? FROM json_each(?) j`).bind(id, session2.account_id, now, rowsJson));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    return failure(409, "plan_changed", "The plan changed while rebuilding. Reload and try again.");
  }
  return show3(request, env, session2, now);
}
async function changeTask(request, env, session2, id, now) {
  const rejected = await requireMutation(request, env, session2);
  if (rejected) return rejected;
  const body2 = await readBody3(request);
  if (body2 instanceof Response) return body2;
  if (Object.keys(body2).some((key2) => !["expectedRevision", "status", "date", "minutes", "title"].includes(key2)) || !Number.isInteger(body2.expectedRevision) || body2.expectedRevision < 0)
    return failure(400, "invalid_task", "Reload this task before changing it.");
  const latest = await currentVersion(env, session2.account_id);
  const task = await env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE id = ? AND account_id = ?`).bind(id, session2.account_id).first();
  if (!task) return failure(404, "not_found", "This task is unavailable.");
  if (task.version_id !== latest?.id || task.revision !== body2.expectedRevision)
    return failure(409, "task_changed", "This task or plan changed. Reload and try again.");
  const primary = await env.DB.prepare("SELECT test_date FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1").bind(session2.account_id).first();
  if (primary?.test_date !== latest.primary_date)
    return failure(409, "plan_stale", "Your primary exam date changed. Rebuild before editing this plan.");
  const settings = JSON.parse(latest.settings_json);
  const zone = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(session2.account_id).first();
  const today2 = localCalendarDate(now, zone?.time_zone && isValidZone(zone.time_zone) ? zone.time_zone : "UTC");
  const date = body2.date === void 0 ? task.scheduled_date : body2.date;
  const minutes = body2.minutes === void 0 ? task.estimated_minutes : body2.minutes;
  const title = body2.title === void 0 ? task.title : body2.title;
  const status = body2.status === void 0 ? task.status : body2.status;
  if (!validDate(date) || !settings.studyDays.includes(weekday(date)) || date >= settings.primaryDate || body2.date !== void 0 && date < today2 || typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 5 || minutes > settings.dailyMinutes || typeof title !== "string" || !title.trim() || title.trim().length > 120 || typeof status !== "string" || !["pending", "done", "skipped"].includes(status))
    return failure(400, "invalid_task", "Keep tasks on a study day before the exam, within your daily minutes.");
  const other = await all(
    env,
    "SELECT estimated_minutes FROM study_plan_tasks WHERE account_id = ? AND version_id = ? AND scheduled_date = ? AND id <> ? AND status != 'skipped'",
    session2.account_id,
    latest.id,
    date,
    id
  );
  if (status !== "skipped" && other.reduce((sum, row) => sum + row.estimated_minutes, 0) + minutes > settings.dailyMinutes)
    return failure(409, "day_full", "That day is full. Choose another study day or shorten the task.");
  const latestGuard = "version_id = (SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1)";
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO study_plan_task_events (id, account_id, version_id, task_id, event_json, created_at_ms)
      SELECT ?, ?, version_id, id, ?, ? FROM study_plan_tasks WHERE id = ? AND account_id = ? AND revision = ? AND ${latestGuard}`).bind(
        crypto.randomUUID(),
        session2.account_id,
        JSON.stringify({ from: taskJson(task), to: { date, minutes, title: title.trim(), status } }),
        now,
        id,
        session2.account_id,
        task.revision,
        session2.account_id
      ),
      env.DB.prepare(`UPDATE study_plan_tasks SET scheduled_date = ?, estimated_minutes = ?, title = ?, status = ?, revision = revision + 1, updated_at_ms = ?
      WHERE id = ? AND account_id = ? AND revision = ? AND ${latestGuard}`).bind(date, minutes, title.trim(), status, now, id, session2.account_id, task.revision, session2.account_id)
    ]);
  } catch {
    return failure(409, "day_full", "That day is full or the plan changed. Reload and choose another study day.");
  }
  if (results[1]?.meta.changes !== 1) return failure(409, "task_changed", "This task changed. Reload and try again.");
  const saved = await env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE id = ? AND account_id = ?`).bind(id, session2.account_id).first();
  return json({ task: taskJson(saved) });
}
function planRoute(request, env, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/account/plan")) return null;
  return (async () => {
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to open your Study Plan.");
    if (path === "/api/account/plan" && request.method === "GET") return show3(request, env, session2, now());
    if (path === "/api/account/plan" && request.method === "POST") return rebuild(request, env, session2, now());
    const task = /^\/api\/account\/plan\/tasks\/([a-f0-9-]{36})$/i.exec(path);
    if (task && request.method === "PATCH") return changeTask(request, env, session2, task[1], now());
    return failure(404, "not_found", "This Study Plan action is unavailable.");
  })();
}

// hosted/src/assistantSecrets.ts
var encoder2 = new TextEncoder();
var hex = (bytes2) => Array.from(bytes2, (n) => n.toString(16).padStart(2, "0")).join("");
function bytes(value) {
  if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error("Invalid encrypted value");
  return Uint8Array.from(value.match(/../g), (part) => parseInt(part, 16));
}
async function key(secret) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Missing encryption key");
  return crypto.subtle.importKey("raw", bytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value, secret, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder2.encode(purpose) }, await key(secret), encoder2.encode(value));
  return `${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}
async function unseal(value, secret, purpose) {
  const [iv, encrypted, extra] = value.split(".");
  if (extra || iv.length !== 24 || !encrypted) throw new Error("Invalid encrypted value");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: encoder2.encode(purpose) }, await key(secret), bytes(encrypted)));
}

// hosted/src/gemini.ts
var GeminiFailure = class extends Error {
  constructor(code, retrySeconds = 0, message2) {
    super(message2 || code);
    this.code = code;
    this.retrySeconds = retrySeconds;
  }
  code;
  retrySeconds;
};
var geminiAdapter = async (payload, model, key2, timeoutMs = 5e4) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key2 },
      // Cloudflare Workers supports manual redirects, not redirect: "error".
      // Non-2xx responses below reject redirects without forwarding the key.
      body: payload,
      signal: controller.signal,
      redirect: "manual"
    });
    if (!response.ok) {
      let reason = "";
      let detailMessage = "";
      try {
        const text2 = await response.text();
        const errorData = JSON.parse(text2);
        reason = errorData?.error?.details?.[0]?.reason ?? errorData?.error?.status ?? "";
        detailMessage = errorData?.error?.message ?? "";
      } catch {
      }
      console.error("gemini_provider_failure", { phase: "http", status: response.status, model, reason, message: detailMessage });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        throw new GeminiFailure("quota_exhausted", Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60);
      }
      if (response.status === 401 || response.status === 403 || reason === "API_KEY_INVALID") {
        throw new GeminiFailure("credential_invalid");
      }
      if (response.status === 404) {
        throw new GeminiFailure("model_unavailable");
      }
      throw new GeminiFailure("provider_error", 10, detailMessage);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      console.error("gemini_provider_failure", { phase: "missing_body", model });
      throw new GeminiFailure("provider_error");
    }
    const chunks = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 262144) {
        await reader.cancel();
        throw new GeminiFailure("provider_error");
      }
      chunks.push(chunk.value);
    }
    const all2 = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      all2.set(chunk, offset);
      offset += chunk.length;
    }
    const data = JSON.parse(new TextDecoder().decode(all2));
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(candidate?.finishReason ?? "")) throw new GeminiFailure("blocked_content");
    if (!candidate || !["STOP", "MAX_TOKENS"].includes(candidate.finishReason ?? "")) {
      console.error("gemini_provider_failure", { phase: "invalid_candidate", finishReason: candidate?.finishReason ?? null, model });
      throw new GeminiFailure("provider_error");
    }
    const text = candidate.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!text?.trim()) {
      console.error("gemini_provider_failure", { phase: "empty_text", finishReason: candidate.finishReason, model });
      throw new GeminiFailure("provider_error", 5, "Model produced no visible output or ran out of tokens.");
    }
    if (text.length > 8e3 || text.includes(key2)) throw new GeminiFailure("blocked_content");
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new GeminiFailure("timeout", 5);
    if (error instanceof GeminiFailure) throw error;
    console.error("gemini_provider_failure", { phase: "transport_or_parse", kind: error instanceof Error ? error.name : typeof error, model });
    throw new GeminiFailure("provider_error", 10);
  } finally {
    clearTimeout(timeout);
  }
};

// hosted/src/planAssistant.ts
var BANDS = ["informationIdeas", "craftStructure", "expressionOfIdeas", "standardEnglishConventions", "algebra", "advancedMath", "problemSolvingDataAnalysis", "geometryTrigonometry"];
var COLUMNS = ["band_information_ideas", "band_craft_structure", "band_expression_of_ideas", "band_standard_english_conventions", "band_algebra", "band_advanced_math", "band_problem_solving_data_analysis", "band_geometry_trigonometry"];
var invalid = () => failure(422, "invalid_suggestions", "These suggested tasks do not fit your current Study Plan. Preview a new suggestion or continue manually.");
var changed = () => failure(409, "plan_changed", "A newer plan or result is available. Preview again before accepting suggestions.");
var weekday2 = (date) => (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
async function planEnvelope(request, env, accountId, now, selection, settingsValue) {
  if (!selection.official && !selection.whitebook)
    return failure(409, "result_source_required", "Select at least one available Official SAT Result or Whitebook Section Exam summary.");
  const settings = validateSettings(settingsValue);
  if (!settings) return failure(400, "invalid_settings", "Choose valid study days, rest days, daily minutes, and an optional score goal.");
  const ctx = await planContext(request, env, accountId, now);
  if (!ctx.primaryDate || settings.primaryDate !== ctx.primaryDate || ctx.primaryDate <= ctx.today)
    return failure(400, "invalid_date", "Choose a future Primary SAT Target on the Dashboard first.");
  const [score, attempt2, progressResponse] = await Promise.all([
    selection.official ? env.DB.prepare(`SELECT id, administration_date, total_score, reading_writing_score, math_score, ${COLUMNS.join(", ")} FROM official_sat_results
      WHERE account_id = ? ORDER BY administration_date DESC, created_at DESC, rowid DESC LIMIT 1`).bind(accountId).first() : null,
    selection.whitebook ? env.DB.prepare(`SELECT id, config_json, completed_at_ms, result_json FROM learner_attempts
      WHERE account_id = ? AND kind = 'section_exam' AND status = 'completed' AND result_json IS NOT NULL
      ORDER BY completed_at_ms DESC, rowid DESC LIMIT 1`).bind(accountId).first() : null,
    progressRoute(new Request(new URL("/api/account/progress", request.url), { headers: request.headers }), env)
  ]);
  if (selection.official && !score || selection.whitebook && !attempt2)
    return failure(409, "result_source_required", "A selected result is unavailable. Choose an available source or continue with your Study Plan.");
  const result = attempt2 ? JSON.parse(attempt2.result_json) : null;
  const section = attempt2 ? JSON.parse(attempt2.config_json).section : null;
  if (attempt2 && (!result || !Number.isInteger(result.correctCount) || !Number.isInteger(result.questionCount) || result.questionCount <= 0 || result.correctCount < 0 || result.correctCount > result.questionCount || !["Math", "Reading and Writing"].includes(section ?? "")))
    return failure(409, "result_source_required", "This Section Exam summary is unavailable.");
  if (!progressResponse?.ok) return failure(503, "service_unavailable", "Progress evidence could not be loaded.");
  const aggregateEvidence = await progressResponse.json();
  const envelope = {
    flow: "study_plan_suggestion",
    today: ctx.today,
    officialSatResult: score ? {
      label: "Official SAT Result",
      resultId: score.id,
      administrationDate: score.administration_date,
      total: score.total_score,
      readingWriting: score.reading_writing_score,
      math: score.math_score,
      skillsInsightBands: Object.fromEntries(BANDS.map((band, index) => [band, score[COLUMNS[index]]]))
    } : null,
    whitebookSectionExam: attempt2 && result ? {
      label: "Whitebook Raw Accuracy",
      attemptId: attempt2.id,
      section,
      completedAt: attempt2.completed_at_ms,
      questionCount: result.questionCount,
      rawAccuracy: Math.round(result.correctCount / result.questionCount * 1e3) / 10
    } : null,
    officialScoreGoal: settings.officialScoreGoal,
    primarySatTarget: settings.primaryDate,
    aggregateEvidence,
    dueCardTotal: ctx.inputs.dueCards,
    planConstraints: { studyDays: settings.studyDays, restDays: settings.restDays, dailyMinutes: settings.dailyMinutes },
    activityCatalog: ctx.inputs.practice.map(({ revisionId, packageTitle, section: section2, questionCount, evidenceCount, rawAccuracy, tentative }) => ({ revisionId, packageTitle, section: section2, questionCount, evidenceCount, rawAccuracy, tentative })).sort((a, b) => a.packageTitle.localeCompare(b.packageTitle) || a.section.localeCompare(b.section) || a.revisionId.localeCompare(b.revisionId))
  };
  return { envelope, settings, context: ctx };
}
function parseProposals(text) {
  if (text.length > 12e3) return null;
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value) || !value.length || value.length > 20) return null;
    return value;
  } catch {
    return null;
  }
}
async function completedReviewKeys(env, accountId) {
  const rows3 = await env.DB.prepare("SELECT action_json FROM study_plan_tasks WHERE account_id = ? AND kind = 'review' AND status = 'done'").bind(accountId).all();
  return new Set(rows3.results.map((row) => {
    const action = JSON.parse(row.action_json);
    return `${action.attemptId}\0${action.questionId}`;
  }));
}
function validateProposals(proposals, settings, ctx, completedReviews = /* @__PURE__ */ new Set()) {
  const used = /* @__PURE__ */ new Map();
  const reviewKeys = /* @__PURE__ */ new Set();
  const tasks = [];
  for (const task of proposals) {
    if (!task || typeof task !== "object" || Array.isArray(task) || Object.keys(task).some((key2) => !["date", "kind", "title", "minutes", "action", "explanation"].includes(key2)) || !validDate(task.date) || task.date < ctx.today || task.date >= settings.primaryDate || !settings.studyDays.includes(weekday2(task.date)) || typeof task.minutes !== "number" || !Number.isInteger(task.minutes) || task.minutes < 5 || task.minutes > settings.dailyMinutes || typeof task.title !== "string" || !task.title.trim() || task.title.trim().length > 120 || /\b(?:guarantee|predict)\w*\b|\b\d+\s*(?:SAT\s*)?points?\b|\b(?:gain|raise|boost|improve)\w*\b.{0,40}\b(?:SAT|score|points?)\b/i.test(task.title) || typeof task.explanation !== "string" || !task.explanation.trim() || task.explanation.length > 500 || !task.action || typeof task.action !== "object" || Array.isArray(task.action)) return invalid();
    const minutes = (used.get(task.date) ?? 0) + task.minutes;
    if (minutes > settings.dailyMinutes) return failure(409, "day_full", "Suggested tasks exceed the available minutes on a study day.");
    used.set(task.date, minutes);
    let evidenceCount = 0;
    let tentative = true;
    let explanation = "";
    let title = "";
    if (task.kind === "cards" && task.action.area === "cards" && Object.keys(task.action).length === 1 && ctx.inputs.dueCards > 0) {
      evidenceCount = ctx.inputs.dueCards;
      tentative = false;
      title = `Review up to ${Math.min(ctx.inputs.dueCards, task.minutes)} due cards`;
      explanation = `${evidenceCount} cards are due as of this plan preview. Check the live due queue when you start.`;
    } else if (task.kind === "review" && task.action.area === "history" && Object.keys(task.action).sort().join() === "area,attemptId,questionId" && ctx.inputs.missed.some((item) => item.attemptId === task.action.attemptId && item.questionId === task.action.questionId)) {
      const key2 = `${task.action.attemptId}\0${task.action.questionId}`;
      if (completedReviews.has(key2) || reviewKeys.has(key2)) return invalid();
      reviewKeys.add(key2);
      const missed = ctx.inputs.missed.find((item) => item.attemptId === task.action.attemptId && item.questionId === task.action.questionId);
      evidenceCount = 1;
      title = `Review missed ${missed.section} question ${missed.questionNumber}`;
      explanation = "One incorrect or unanswered response in a completed Whitebook Attempt. Guided review does not change Raw Accuracy.";
    } else if (task.kind === "practice" && task.action.area === "practice" && Object.keys(task.action).sort().join() === "area,revisionId,section") {
      const activity = ctx.inputs.practice.find((item) => item.revisionId === task.action.revisionId && item.section === task.action.section);
      if (!activity) return invalid();
      evidenceCount = activity.evidenceCount;
      tentative = activity.tentative || !evidenceCount;
      title = `Practice ${activity.section} \xB7 ${activity.packageTitle}`.slice(0, 120);
      explanation = evidenceCount ? `${evidenceCount} unassisted graded questions in this Section; Whitebook Raw Accuracy ${activity.rawAccuracy}%. This is practice evidence, not SAT points.` : "Baseline Whitebook Practice from an available Test Package; no unassisted Section evidence yet.";
    } else return invalid();
    tasks.push({
      date: task.date,
      kind: task.kind,
      title,
      minutes: task.minutes,
      action: task.action,
      evidenceCount,
      tentative,
      explanation
    });
  }
  return tasks;
}
async function acceptProposals(request, env, accountId, now, proposalRowId, expectedVersionId, selection, settings, originalEnvelope, proposed) {
  const current = await planEnvelope(request, env, accountId, now, selection, settings);
  if (current instanceof Response || JSON.stringify(current.envelope) !== JSON.stringify(originalEnvelope)) return changed();
  const latest = await env.DB.prepare("SELECT id, version FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1").bind(accountId).first();
  if ((latest?.id ?? null) !== expectedVersionId) return changed();
  const tasks = validateProposals(proposed, settings, current.context, await completedReviewKeys(env, accountId));
  if (tasks instanceof Response) return tasks;
  const id = crypto.randomUUID();
  const source = JSON.stringify(current.context.source);
  const rows3 = JSON.stringify(tasks.map((task) => ({ ...task, id: crypto.randomUUID() })));
  const statements = [
    env.DB.prepare(`INSERT INTO study_plan_versions (id, account_id, version, primary_date, settings_json, source_json, created_at_ms)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM assistant_previews WHERE id = ? AND account_id = ? AND expires_at_ms > ?)
      AND COALESCE((SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1), '') = ?`).bind(
      id,
      accountId,
      (latest?.version ?? 0) + 1,
      settings.primaryDate,
      JSON.stringify(settings),
      source,
      now,
      proposalRowId,
      accountId,
      now,
      accountId,
      expectedVersionId ?? ""
    ),
    env.DB.prepare(`INSERT INTO study_plan_tasks
      (id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, account_id, updated_at_ms)
      SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.date'), json_extract(j.value, '$.kind'),
      json_extract(j.value, '$.title'), json_extract(j.value, '$.minutes'), json_extract(j.value, '$.action'),
      json_extract(j.value, '$.evidenceCount'), json_extract(j.value, '$.tentative'), json_extract(j.value, '$.explanation'),
      'pending', 0, ?, ? FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM study_plan_versions WHERE id = ? AND account_id = ?)`).bind(id, accountId, now, rows3, id, accountId),
    env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ?").bind(proposalRowId, accountId)
  ];
  try {
    const results = await env.DB.batch(statements);
    if (results[0]?.meta.changes !== 1) return changed();
  } catch {
    return changed();
  }
  return Response.json({ versionId: id, version: (latest?.version ?? 0) + 1 });
}

// hosted/src/assistant.ts
var UUID2 = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
var HOUR = 36e5;
var MAX_OUTPUT = 1024;
var PLAN_OUTPUT = 4096;
var MAX_PAYLOAD = 16e3;
var MAX_MULTIMODAL_PAYLOAD = 41e5;
var MAX_ATTACHMENT_BYTES = 3e6;
var MAX_SEND_BODY_BYTES = 1e7;
var json2 = (data) => Response.json(data, { headers: noStore });
var invalid2 = () => failure(400, "invalid_request", "Check the prompt and Gemini selection, then preview again.");
var consentRequired = () => failure(409, "consent_required", "This preview changed or expired. Preview and consent again.");
var bodyHasExactly = (body2, required, optional = []) => required.every((key2) => Object.prototype.hasOwnProperty.call(body2, key2)) && Object.keys(body2).every((key2) => required.includes(key2) || optional.includes(key2));
var sharedGeminiKey = (env) => env.GCP_GEMINI_SHARED_KEY || env.GEMINI_SHARED_KEY;
function catalog(env, now) {
  if (env.AI_RELEASE_ENABLED !== "true" || !env.ASSISTANT_KEY_KEK || !env.ASSISTANT_SNAPSHOT_KEY) return [];
  try {
    const data = JSON.parse(env.ASSISTANT_CATALOG ?? "null");
    if (!data || !Number.isFinite(data.reviewedUntil) || data.reviewedUntil <= now || data.reviewedUntil > now + 7 * 864e5 || data.audienceEligibility !== "signed_in_adults_18_plus" || data.providerEligibility !== "approved" || typeof data.eligibilityEvidence !== "string" || !data.eligibilityEvidence.trim() || typeof data.failureCheckEvidence !== "string" || !data.failureCheckEvidence.trim() || !Array.isArray(data.options)) return [];
    const options = [];
    for (const row of data.options) {
      if (!["shared_gemini", "personal_gemini"].includes(row.route) || !/^gemini-[a-z0-9.-]+$/.test(row.model) || ![row.payer, row.price, row.terms, row.termsVersion, row.quota].every((v) => typeof v === "string" && v.trim() && v.length <= 2e3) || row.termsUrl !== "https://ai.google.dev/gemini-api/terms" || typeof row.vision !== "boolean" || typeof row.healthy !== "boolean" || !Array.isArray(row.languages) || !row.languages.length || !row.languages.every((v) => v === "en" || v === "vi")) return [];
      options.push({ route: row.route, model: row.model, payer: row.payer, price: row.price, terms: row.terms, termsUrl: row.termsUrl, termsVersion: row.termsVersion, languages: row.languages, vision: row.vision, quota: row.quota, healthy: row.healthy });
    }
    if (new Set(options.map((o) => o.route + o.model)).size !== options.length) return [];
    const result = [];
    for (const item of options) {
      result.push(item);
      if (GEMINI_CANDIDATE_MODELS.includes(item.model)) {
        for (const candidate of GEMINI_CANDIDATE_MODELS) {
          if (candidate !== item.model && !options.some((o) => o.route === item.route && o.model === candidate) && !result.some((o) => o.route === item.route && o.model === candidate)) {
            result.push({ ...item, model: candidate });
          }
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}
async function credential(env, account) {
  return env.DB.prepare("SELECT version, ciphertext, last_four FROM assistant_credentials WHERE account_id = ?").bind(account).first();
}
async function routeKey(env, account, option) {
  if (option.route === "shared_gemini") {
    const key2 = sharedGeminiKey(env);
    if (!key2) return null;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key2));
    return { key: key2, version: Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("") };
  }
  const row = await credential(env, account);
  return row ? { key: await unseal(row.ciphertext, env.ASSISTANT_KEY_KEK, `credential:${account}`), version: row.version } : null;
}
function rateLimitedResponse(code, seconds, now) {
  return Response.json({ error: { code, message: `Tutor Chat is unavailable. Try again in ${seconds} seconds.`, retryAt: now + seconds * 1e3 } }, { status: 429, headers: { ...noStore, "Retry-After": String(seconds) } });
}
async function reserve(env, scope, tokens, requests, budget, now) {
  const row = await env.DB.prepare("INSERT INTO assistant_limits (scope, window_ms, requests, tokens) VALUES (?, ?, 1, ?) ON CONFLICT(scope, window_ms) DO UPDATE SET requests = requests + 1, tokens = tokens + excluded.tokens WHERE requests < ? AND tokens + excluded.tokens <= ? RETURNING requests").bind(scope, Math.floor(now / HOUR) * HOUR, tokens, requests, budget).first();
  return !!row;
}
async function bodyOf(request, limit = 7e4) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder2 = new TextDecoder();
  let raw = "";
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    raw += decoder2.decode(next.value, { stream: true });
  }
  try {
    const b = JSON.parse(raw + decoder2.decode());
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}
function encodeBase642(bytes2) {
  let binary = "";
  for (let offset = 0; offset < bytes2.length; offset += 32768)
    binary += String.fromCharCode(...bytes2.subarray(offset, Math.min(offset + 32768, bytes2.length)));
  return btoa(binary);
}
async function sha2564(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function estimateTokens(payload, visuals = []) {
  const textOnly = payload.replace(/("data"\s*:\s*")[A-Za-z0-9+/=]*(")/g, "$1$2");
  const textTokens = Math.ceil(new TextEncoder().encode(textOnly).length / 4);
  const imageTokens = visuals.reduce((sum, visual2) => sum + 258 * Math.ceil(visual2.width * visual2.height / (768 * 768)), 0);
  return textTokens + imageTokens + MAX_OUTPUT;
}
function generationConfigOf(model, maxOutputTokens) {
  const config = { maxOutputTokens };
  const m = typeof model === "string" ? model : "";
  if (m.includes("3.") || m.includes("gemini-3")) {
    config.thinkingConfig = { thinkingLevel: "low" };
  } else if (m.includes("2.5") || m.includes("2.0-flash-thinking")) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}
var GEMINI_CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash"
];
function adaptPayloadForModel(rawPayload, targetModel) {
  try {
    const parsed = JSON.parse(rawPayload);
    if (parsed && typeof parsed === "object" && parsed.generationConfig) {
      const maxTokens = Number(parsed.generationConfig.maxOutputTokens) || MAX_OUTPUT;
      parsed.generationConfig = generationConfigOf(targetModel, maxTokens);
      return JSON.stringify(parsed);
    }
  } catch {
  }
  return rawPayload;
}
async function executeWithModelFallback(adapter, payload, primaryModel, key2) {
  const isCandidate = GEMINI_CANDIDATE_MODELS.includes(primaryModel) || primaryModel.startsWith("gemini-3") || primaryModel.startsWith("gemini-2");
  const models = isCandidate ? [primaryModel, ...GEMINI_CANDIDATE_MODELS.filter((m) => m !== primaryModel)] : [primaryModel];
  let lastError = null;
  const attempted = [];
  for (let i = 0; i < models.length; i++) {
    const candidateModel = models[i];
    attempted.push(candidateModel);
    const candidatePayload = adaptPayloadForModel(payload, candidateModel);
    try {
      const text = await adapter(candidatePayload, candidateModel, key2);
      return { text, model: candidateModel, attempted };
    } catch (err) {
      lastError = err;
      const failure2 = err instanceof GeminiFailure ? err : null;
      if (failure2 && (failure2.code === "credential_invalid" || failure2.code === "blocked_content")) {
        throw err;
      }
      console.warn("gemini_model_fallback_retry", {
        attempt: i + 1,
        failedModel: candidateModel,
        reason: failure2?.message || (err instanceof Error ? err.message : String(err)),
        nextModel: i < models.length - 1 ? models[i + 1] : null
      });
      if (i < models.length - 1) {
        const jitter = Math.floor(Math.random() * 80) + 40;
        await new Promise((resolve) => setTimeout(resolve, jitter));
      }
    }
  }
  if (lastError instanceof GeminiFailure) {
    const isTransient = ["provider_error", "quota_exhausted", "model_unavailable", "timeout"].includes(lastError.code);
    if (isTransient && attempted.length > 1) {
      const summaryMsg = `All tested models (${attempted.join(", ")}) are currently experiencing high demand or rate limits. Spikes in demand are temporary. Please try again in a few moments.`;
      throw new GeminiFailure(lastError.code, Math.max(lastError.retrySeconds, 10), summaryMsg);
    }
  }
  throw lastError;
}
function payloadOf(body2, attachment2) {
  if (body2.locale !== "en" && body2.locale !== "vi" || typeof body2.currentMessage !== "string" || !body2.currentMessage.trim() || body2.currentMessage.length > 4e3 || !Array.isArray(body2.priorMessages) || body2.priorMessages.length > 40) return null;
  const turns = [];
  for (const m of body2.priorMessages) {
    if (!m || typeof m !== "object" || !bodyHasExactly(m, ["role", "text"]) || !["learner", "assistant"].includes(m.role) || typeof m.text !== "string" || m.text.length > 8e3) return null;
    turns.push({ role: m.role === "learner" ? "user" : "model", parts: [{ text: m.text }] });
  }
  const contents = turns.slice(-8);
  const attachmentText = attachment2 ? `

Reviewed question attachment (authoritative answer key remains outside Gemini grading):
${JSON.stringify({
    section: attachment2.section,
    module: attachment2.module,
    questionNumber: attachment2.questionNumber,
    response: attachment2.response,
    acceptedAnswers: attachment2.acceptedAnswers,
    presentation: attachment2.presentation,
    visuals: attachment2.visuals.map(({ width, height, alt, mimeType }) => ({ width, height, alt, mimeType }))
  })}` : "";
  const visualParts = attachment2?.visuals.flatMap((visual2, index) => [
    { text: `Attached visual ${index + 1}: ${visual2.width} \xD7 ${visual2.height}; alt: ${visual2.alt}` },
    { inlineData: { mimeType: visual2.mimeType, data: visual2.data } }
  ]) ?? [];
  contents.push({ role: "user", parts: [{ text: body2.currentMessage + attachmentText }, ...visualParts] });
  const serialize = () => JSON.stringify({ systemInstruction: { parts: [{ text: `You are a study tutor. Respond in ${body2.locale === "vi" ? "Vietnamese" : "English"}. Your responses are unverified learning help, not authoritative grades.` }] }, contents, generationConfig: generationConfigOf(body2.model, MAX_OUTPUT) });
  const maxPayload = attachment2?.visuals.length ? MAX_MULTIMODAL_PAYLOAD : MAX_PAYLOAD;
  while (contents.length > 1 && new TextEncoder().encode(serialize()).length > maxPayload) contents.shift();
  const result = serialize();
  return new TextEncoder().encode(result).length <= maxPayload ? result : null;
}
function presentationText(value) {
  if (!value || typeof value !== "object") return [];
  const blocks = [];
  const presentation = value;
  blocks.push(...presentation.stimulus ?? [], ...presentation.stem ?? [], ...(presentation.choices ?? []).flatMap((choice) => choice.content ?? []));
  return blocks.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const item = block;
    if (typeof item.text === "string") return [item.text];
    if (typeof item.latex === "string") return [item.latex];
    return Array.isArray(item.runs) ? item.runs.flatMap((run) => typeof run.text === "string" ? [run.text] : []) : [];
  });
}
function normalized(value) {
  return value.toLocaleLowerCase().normalize("NFKC").replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "($1/$2)").replace(/(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*(\d+)/g, (_match, coefficient, power) => String(Number(coefficient) * 10 ** Number(power))).replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (_match, numerator, denominator) => String(Number(numerator) / Number(denominator))).replace(/\d+(?:\.\d+)?/g, (number) => String(Number(number))).replace(/[^a-z0-9.+/=\-]/g, "");
}
function unsafeReasoning(text, context, stage = "reasoning_steps") {
  const value = normalized(text);
  for (const answer of context.acceptedAnswers) {
    const key2 = answer.trim();
    const normalizedAnswer = normalized(key2);
    if (normalizedAnswer.length >= 2 && value.includes(normalizedAnswer)) return true;
    const disclosureText = text.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    if (/^[a-d]$/i.test(key2) && (new RegExp(`\\b(answer|correct|choose|select|pick|option|choice)\\b.{0,32}\\b${key2}\\b`, "i").test(text) || new RegExp(`\\b(dap\\s+an|chon)\\b.{0,32}\\b${key2}\\b`, "i").test(disclosureText))) return true;
    if (/^[-+]?\$?\d+(?:,\d{3})*(?:\.\d+)?$/.test(key2)) {
      const expected = Number(key2.replace(/[$,]/g, ""));
      if (Array.from(text.matchAll(/[-+]?\$?\d+(?:,\d{3})*(?:\.\d+)?/g), (match) => Number(match[0].replace(/[$,]/g, ""))).some((number) => Number.isFinite(number) && Math.abs(number - expected) < 1e-9)) return true;
    }
  }
  if (context.correctChoiceText.some((choice) => normalized(choice).length >= 3 && value.includes(normalized(choice)))) return true;
  if (context.correctChoiceText.some((choice) => /however|nevertheless|nonetheless/i.test(choice) && /\b(however|nevertheless|nonetheless|still|yet|even so)\b/i.test(text))) return true;
  if (/\b(only one|one and only one|single remaining)\b.{0,36}\b(option|choice|candidate|answer)\b|\b(only|just) one (option|choice|candidate) (?:is )?left\b/i.test(text)) return true;
  if (context.correctChoiceText.some((choice) => /however|nevertheless|nonetheless/i.test(choice)) && /\bword\b.{0,48}\b(signal|indicate|show)\w*\b.{0,32}\bcontrast\b|\bword meaning ["“]?however/i.test(text)) return true;
  const choices = context.questionText.map(normalized).filter((choice) => choice.length >= 12);
  if (choices.some((choice) => value.includes(choice))) return true;
  if (!context.revealed && context.section === "Math" && stage !== "follow_up" && /\b(desmos|graph|plot|calculator|passes through|test each equation|substitute)\b/i.test(text)) return true;
  return false;
}
function providerQuestionText(presentation, acceptedAnswers, revealed) {
  if (revealed || !presentation || typeof presentation !== "object") return presentationText(presentation);
  const value = presentation;
  const accepted = new Set(acceptedAnswers.map((answer) => answer.trim().toUpperCase()));
  return presentationText({ ...value, choices: (value.choices ?? []).filter((choice) => !accepted.has(String(choice.id ?? "").toUpperCase())) });
}
async function reasoningContext(env, accountId, reviewId) {
  const review2 = await env.DB.prepare("SELECT id, attempt_id, revision_id, question_id, revealed_at_ms FROM guided_reviews WHERE id = ? AND account_id = ?").bind(reviewId, accountId).first();
  if (!review2) return failure(404, "not_found", "This reviewed question is unavailable.");
  if (!await hasPackageEntitlement(env, accountId, review2.revision_id)) return failure(404, "not_found", "This reviewed question is unavailable.");
  const attempt2 = await env.DB.prepare("SELECT status, result_json FROM learner_attempts WHERE id = ? AND account_id = ?").bind(review2.attempt_id, accountId).first();
  const question3 = await env.DB.prepare("SELECT section, response_type, presentation_json FROM publication_questions WHERE revision_id = ? AND question_id = ?").bind(review2.revision_id, review2.question_id).first();
  if (!attempt2 || attempt2.status !== "completed" || !attempt2.result_json || !question3) return failure(409, "review_incomplete", "Guided Reasoning is available after this Attempt is complete.");
  const grade = JSON.parse(attempt2.result_json).questions.find((item) => item.questionId === review2.question_id);
  if (!grade) return failure(404, "not_found", "This reviewed question is unavailable.");
  const presentation = JSON.parse(question3.presentation_json);
  const help2 = await env.DB.prepare("SELECT reviewed_hint FROM publication_review_help WHERE revision_id = ? AND question_id = ?").bind(review2.revision_id, review2.question_id).first();
  const questionText = presentationText(presentation);
  const acceptedKeys = new Set(grade.acceptedAnswers.map((answer) => answer.trim().toUpperCase()));
  const correctChoiceText = (presentation.choices ?? []).filter((choice) => acceptedKeys.has(String(choice.id ?? "").toUpperCase())).flatMap((choice) => presentationText({ stimulus: [], stem: choice.content ?? [], choices: [] }));
  const revealed = review2.revealed_at_ms !== null;
  return {
    reviewId,
    revisionId: review2.revision_id,
    questionId: review2.question_id,
    section: question3.section,
    responseType: question3.response_type,
    revealed,
    response: grade.response,
    acceptedAnswers: grade.acceptedAnswers,
    presentation,
    questionText,
    correctChoiceText,
    fallbackHint: help2?.reviewed_hint ?? null
  };
}
async function reasoningPreview(body2, env, session2, options, now) {
  if (!bodyHasExactly(body2, ["visitId", "reviewId", "route", "model", "locale", "stage", "message"]) || typeof body2.visitId !== "string" || !UUID2.test(body2.visitId) || typeof body2.reviewId !== "string" || typeof body2.message !== "string" || !body2.message.trim() || body2.message.length > 4e3 || !["en", "vi"].includes(String(body2.locale)) || !["reasoning_steps", "reading_help", "follow_up"].includes(String(body2.stage))) return invalid2();
  const provider = options.find((item) => item.route === body2.route && item.model === body2.model);
  if (!provider || !provider.healthy || !provider.languages.includes(body2.locale)) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  const context = await reasoningContext(env, session2.account_id, body2.reviewId);
  if (context instanceof Response) return context;
  const answer = context.revealed ? `
Accepted answer (server verified; do not regrade): ${JSON.stringify(context.acceptedAnswers)}` : "";
  const mathHelp = context.section === "Math" && context.revealed ? " Give a standard, clear worked solution using the verified answer. Include a Desmos approach only when graphing or checking intersections materially helps; do not force calculator instructions." : "";
  const responseText = context.revealed ? context.response ?? "unanswered" : "Withheld until the learner reveals the answer.";
  const visibleQuestionText = providerQuestionText(context.presentation, context.acceptedAnswers, context.revealed);
  const instruction = `You are Guided Reasoning for a reviewed Whitebook question. Respond in ${body2.locale === "vi" ? "Vietnamese" : "English"}. Before reveal, provide only answer-neutral reasoning steps and never identify, quote, paraphrase, eliminate choices toward, or narrow to the accepted answer. After reveal, explain the answer but do not claim grading authority.${mathHelp}`;
  const payload = JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: `${body2.stage}: ${body2.message}
Question presentation text: ${JSON.stringify(visibleQuestionText)}
Learner response: ${responseText}${answer}` }] }], generationConfig: generationConfigOf(provider.model, MAX_OUTPUT) });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD) return invalid2();
  const key2 = await routeKey(env, session2.account_id, provider);
  if (!key2) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  if (!await reserve(env, `preview:${session2.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1e3), now);
  const snapshot2 = { id: crypto.randomUUID(), account: session2.account_id, session: session2.token_hash, visit: body2.visitId, expires: now + 5 * 6e4, provider, credentialVersion: key2.version, payload, tokens: new TextEncoder().encode(payload).length + MAX_OUTPUT, flow: "reasoning", reviewId: context.reviewId, stage: String(body2.stage), revealed: context.revealed, acceptedAnswers: context.acceptedAnswers, questionText: context.questionText, correctChoiceText: context.correctChoiceText, section: context.section, fallbackHint: context.fallbackHint };
  const previewId = await seal(JSON.stringify(snapshot2), env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, snapshot2.expires).run();
  return json2({ previewId, expiresAt: snapshot2.expires, provider, payload, revealed: context.revealed, question: { revisionId: context.revisionId, questionId: context.questionId, presentation: context.presentation }, fallbackHint: context.fallbackHint });
}
async function reasoningSend(body2, env, session2, options, adapter, now) {
  if (!bodyHasExactly(body2, ["previewId", "visitId", "consent"]) || body2.consent !== true || typeof body2.previewId !== "string" || typeof body2.visitId !== "string") return consentRequired();
  let snapshot2;
  try {
    snapshot2 = JSON.parse(await unseal(body2.previewId, env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview"));
  } catch {
    return consentRequired();
  }
  if (snapshot2.flow !== "reasoning" || snapshot2.account !== session2.account_id || snapshot2.session !== session2.token_hash || snapshot2.visit !== body2.visitId || snapshot2.expires <= now) return consentRequired();
  const provider = options.find((item) => item.route === snapshot2.provider.route && item.model === snapshot2.provider.model);
  const key2 = provider && await routeKey(env, session2.account_id, provider);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot2.provider) || !key2 || key2.version !== snapshot2.credentialVersion) return consentRequired();
  const current = await reasoningContext(env, session2.account_id, snapshot2.reviewId);
  if (current instanceof Response || current.revealed !== snapshot2.revealed) return consentRequired();
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, now).first();
  if (!consumed) return consentRequired();
  const retry = Math.ceil((HOUR - now % HOUR) / 1e3);
  if (!await reserve(env, `send:${session2.account_id}`, snapshot2.tokens, 20, 8e4, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot2.tokens, 100, 4e5, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try {
    const text = await adapter(snapshot2.payload, provider.model, key2.key);
    if (!text.trim() || text.length > 8e3 || text.includes(key2.key)) return failure(502, "provider_error", "Guided Reasoning could not produce a safe explanation.");
    if (!snapshot2.revealed && unsafeReasoning(text, current, snapshot2.stage)) return json2({ withheld: true, answerWithheld: true, hint: snapshot2.fallbackHint, message: snapshot2.fallbackHint ? "A reviewed hint is available instead of generated text." : "This generated step was withheld because its answer safety could not be verified." });
    return json2({ text, verified: false, label: "Not verified against the answer key" });
  } catch {
    return failure(502, "provider_error", "Guided Reasoning could not complete this request. Your draft is preserved.");
  }
}
async function flashcardPreview(body2, env, session2, options, now) {
  if (!bodyHasExactly(body2, ["visitId", "route", "model", "locale", "mode", "words", "deck", "cardIds"], ["context"]) || typeof body2.visitId !== "string" || !UUID2.test(body2.visitId) || !["draft_cards", "deck_advice"].includes(String(body2.mode)) || typeof body2.deck !== "string" || body2.deck.length > 80 || !Array.isArray(body2.cardIds) || body2.cardIds.length > 20 || body2.cardIds.some((id) => typeof id !== "string" || !UUID2.test(id)) || new Set(body2.cardIds).size !== body2.cardIds.length || body2.mode === "draft_cards" && (typeof body2.words !== "string" || Boolean(body2.words.trim()) === body2.cardIds.length > 0 || body2.words.length > 4e3) || body2.mode === "deck_advice" && (typeof body2.words !== "string" || !body2.words.trim() || body2.cardIds.length > 0)) return invalid2();
  const provider = options.find((item) => item.route === body2.route && item.model === body2.model);
  if (!provider || !provider.healthy || !provider.languages.includes(body2.locale)) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  let selected;
  let cardRows = [];
  if (body2.mode === "deck_advice") {
    const cards = await env.DB.prepare("SELECT p.id, p.front, p.definition, p.vietnamese, p.part_of_speech, p.pronunciation, p.synonyms, p.example, r.rating, r.next_due FROM personal_cards p LEFT JOIN (SELECT card_id, rating, next_due, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY rated_at DESC, id DESC) AS rn FROM card_rating_events WHERE account_id = ?) r ON r.card_id = p.id AND r.rn = 1 WHERE p.account_id = ? AND p.deck_key = ? AND p.archived_at IS NULL ORDER BY p.front LIMIT 100").bind(session2.account_id, session2.account_id, body2.deck.toLocaleLowerCase().replace(/\s+/g, " ").trim()).all();
    cardRows = cards.results;
    const zoneRow = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(session2.account_id).first();
    const zone = zoneRow?.time_zone && isValidZone(zoneRow.time_zone) ? zoneRow.time_zone : "UTC";
    const today2 = localCalendarDate(now, zone);
    const due = cardRows.filter((card) => !card.next_due || card.next_due <= today2).length;
    selected = {
      cards: cardRows.map(({ front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example }) => ({ front, definition, vietnamese, partOfSpeech: part_of_speech, pronunciation, synonyms, example })),
      summary: {
        total: cardRows.length,
        due,
        notDue: cardRows.length - due,
        ratings: { sure: cardRows.filter((card) => card.rating === "sure").length, notSure: cardRows.filter((card) => card.rating === "not_sure").length, unrated: cardRows.filter((card) => !card.rating).length }
      }
    };
  } else if (body2.cardIds.length) {
    const cards = await env.DB.prepare(`SELECT id, front, '' AS definition, '' AS vietnamese, '' AS part_of_speech, '' AS pronunciation, '' AS synonyms, '' AS example, NULL AS rating, NULL AS next_due FROM personal_cards WHERE account_id = ? AND archived_at IS NULL AND id IN (${body2.cardIds.map(() => "?").join(", ")})`).bind(session2.account_id, ...body2.cardIds).all();
    const byId = new Map(cards.results.map((card) => [card.id, card]));
    if (body2.cardIds.some((id) => !byId.has(id))) return failure(409, "source_cards_changed", "A selected Personal Card is no longer available. Refresh the selection before previewing again.");
    selected = body2.cardIds.map((id) => ({ front: byId.get(id).front }));
  } else selected = String(body2.words).split(/[\n,]+/).map((word) => word.trim()).filter(Boolean).slice(0, 20).map((front) => ({ front }));
  if (body2.mode === "deck_advice" && !cardRows.length) return failure(404, "deck_unavailable", "Choose a Personal Deck with cards before requesting advice.");
  const outputFormat = body2.mode === "draft_cards" ? "For card drafts, return exactly one valid JSON array and nothing else: no markdown fences, headings, or extra prose. Each item must be an object with string fields front, definition, vietnamese, partOfSpeech, pronunciation, synonyms, and example. Use empty strings for unknown optional fields; include a non-empty front and at least one non-empty back field. Return at most 20 items." : "For deck advice, respond with concise plain text and do not create or save cards.";
  const userPrompt = body2.mode === "deck_advice" ? { mode: body2.mode, question: String(body2.words).slice(0, 4e3), selectedDeck: body2.deck, deckSnapshot: selected, context: typeof body2.context === "string" ? body2.context.slice(0, 2e3) : "" } : { mode: body2.mode, sourceWords: selected, context: typeof body2.context === "string" ? body2.context.slice(0, 2e3) : "", destinationDeck: body2.deck };
  const payload = JSON.stringify({ systemInstruction: { parts: [{ text: `You are Flashcard Assistant. Respond in ${body2.locale === "vi" ? "Vietnamese" : "English"}. Propose learner-editable Personal Card content only; never save cards. ${outputFormat}` }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(userPrompt) }] }], generationConfig: generationConfigOf(provider.model, MAX_OUTPUT) });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD) return invalid2();
  const key2 = await routeKey(env, session2.account_id, provider);
  if (!key2) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  if (!await reserve(env, `preview:${session2.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1e3), now);
  const snapshot2 = { id: crypto.randomUUID(), account: session2.account_id, session: session2.token_hash, visit: body2.visitId, expires: now + 5 * 6e4, provider, credentialVersion: key2.version, payload, tokens: new TextEncoder().encode(payload).length + MAX_OUTPUT, flow: "flashcards" };
  const previewId = await seal(JSON.stringify(snapshot2), env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, snapshot2.expires).run();
  return json2({ previewId, expiresAt: snapshot2.expires, provider, payload, mode: body2.mode, deck: body2.deck });
}
async function flashcardSend(body2, env, session2, options, adapter, now) {
  if (!bodyHasExactly(body2, ["previewId", "visitId", "consent"]) || body2.consent !== true || typeof body2.previewId !== "string" || typeof body2.visitId !== "string") return consentRequired();
  let snapshot2;
  try {
    snapshot2 = JSON.parse(await unseal(body2.previewId, env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview"));
  } catch {
    return consentRequired();
  }
  if (snapshot2.flow !== "flashcards" || snapshot2.account !== session2.account_id || snapshot2.session !== session2.token_hash || snapshot2.visit !== body2.visitId || snapshot2.expires <= now) return consentRequired();
  const provider = options.find((item) => item.route === snapshot2.provider.route && item.model === snapshot2.provider.model);
  const key2 = provider && await routeKey(env, session2.account_id, provider);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot2.provider) || !key2 || key2.version !== snapshot2.credentialVersion) return consentRequired();
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, now).first();
  if (!consumed) return consentRequired();
  const retry = Math.ceil((HOUR - now % HOUR) / 1e3);
  if (!await reserve(env, `send:${session2.account_id}`, snapshot2.tokens, 20, 8e4, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot2.tokens, 100, 4e5, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try {
    const result = await executeWithModelFallback(adapter, snapshot2.payload, provider.model, key2.key);
    const text = result.text;
    if (!text.trim() || text.length > 12e3 || text.includes(key2.key)) return failure(502, "provider_error", "Flashcard Assistant returned an unavailable draft.");
    return json2({
      text,
      provider: { ...provider, model: result.model },
      verified: false,
      ...result.model !== provider.model ? { fallback: { originalModel: provider.model, activeModel: result.model } } : {}
    });
  } catch {
    return failure(502, "provider_error", "Flashcard Assistant could not complete this request. Your draft is preserved.");
  }
}
async function attachment(env, accountId, reviewId, includeVisuals, requestUrl) {
  const review2 = await env.DB.prepare("SELECT id, attempt_id, revision_id, question_id, revealed_at_ms FROM guided_reviews WHERE id = ? AND account_id = ?").bind(reviewId, accountId).first();
  if (!review2) return failure(404, "not_found", "This reviewed question is unavailable.");
  if (review2.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal this reviewed question before attaching it.");
  if (!await hasPackageEntitlement(env, accountId, review2.revision_id)) return failure(409, "attachment_unavailable", "This reviewed question is no longer available.");
  const source = await env.DB.prepare("SELECT status, result_json FROM learner_attempts WHERE id = ? AND account_id = ?").bind(review2.attempt_id, accountId).first();
  const question3 = await env.DB.prepare("SELECT section, module, question_number, presentation_json FROM publication_questions WHERE revision_id = ? AND question_id = ?").bind(review2.revision_id, review2.question_id).first();
  if (!source || source.status !== "completed" || !source.result_json || !question3) return failure(404, "not_found", "This reviewed question is unavailable.");
  const result = JSON.parse(source.result_json).questions.find((item) => item.questionId === review2.question_id);
  if (!result) return failure(404, "not_found", "This reviewed question is unavailable.");
  const presentation = JSON.parse(question3.presentation_json);
  const blocks = [...presentation.stimulus ?? [], ...presentation.stem ?? [], ...(presentation.choices ?? []).flatMap((choice) => choice.content ?? [])];
  const visuals = [];
  let attachmentBytes = 0;
  if (includeVisuals) {
    for (const block of blocks) {
      if (block.kind === "asset") return failure(409, "attachment_unavailable", "Only reviewed derived PNG visuals can be shared with Gemini.");
      if (block.kind !== "image_asset") continue;
      if (typeof block.assetId !== "string" || !/^[a-f0-9]{64}$/.test(block.assetId) || !Number.isSafeInteger(block.width) || !Number.isSafeInteger(block.height) || block.width <= 0 || block.height <= 0 || typeof block.alt !== "string" || block.alt.length > 500)
        return failure(409, "attachment_unavailable", "This reviewed visual is unavailable for sharing.");
      const path = `/content/${review2.revision_id}/${review2.question_id}/${block.assetId}.png`;
      const stored = await env.DB.prepare("SELECT content_type, sha256, byte_size FROM publication_assets WHERE path = ? AND revision_id = ? AND question_id = ?").bind(path, review2.revision_id, review2.question_id).first();
      if (!stored || stored.content_type !== "image/png" || !/^[a-f0-9]{64}$/.test(stored.sha256) || !Number.isSafeInteger(stored.byte_size) || stored.byte_size <= 0)
        return failure(409, "attachment_unavailable", "This reviewed visual is no longer available.");
      attachmentBytes += stored.byte_size;
      if (attachmentBytes > MAX_ATTACHMENT_BYTES) return failure(413, "attachment_too_large", "The selected visuals exceed the Gemini attachment limit.");
      const asset = await env.ASSETS.fetch(new Request(new URL(path, requestUrl), { method: "GET" }));
      if (!asset.ok) return failure(503, "visual_unavailable", "A selected visual could not be loaded. Preview again before sending.");
      const bytes2 = await asset.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes2);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (bytes2.byteLength !== stored.byte_size || hash !== stored.sha256)
        return failure(503, "visual_unavailable", "A selected visual changed or failed verification. Preview again before sending.");
      visuals.push({ path, width: block.width, height: block.height, alt: block.alt, mimeType: stored.content_type, data: encodeBase642(new Uint8Array(bytes2)) });
    }
  }
  return { reviewId, revisionId: review2.revision_id, questionId: review2.question_id, section: question3.section, module: question3.module, questionNumber: question3.question_number, response: result.response, acceptedAnswers: result.acceptedAnswers, presentation, visuals: includeVisuals ? visuals : [] };
}
async function attachmentList(env, accountId) {
  const rows3 = await env.DB.prepare("SELECT g.id, g.attempt_id, g.revision_id, g.question_id, g.revealed_at_ms, a.completed_at_ms, pq.section, pq.module, pq.question_number FROM guided_reviews g JOIN learner_attempts a ON a.id = g.attempt_id AND a.account_id = g.account_id JOIN publication_questions pq ON pq.revision_id = g.revision_id AND pq.question_id = g.question_id WHERE g.account_id = ? AND g.revealed_at_ms IS NOT NULL AND a.status = 'completed' ORDER BY g.updated_at_ms DESC").bind(accountId).all();
  const eligible = [];
  for (const row of rows3.results) {
    if (await hasPackageEntitlement(env, accountId, row.revision_id)) eligible.push({ reviewId: row.id, attemptId: row.attempt_id, revisionId: row.revision_id, questionId: row.question_id, section: row.section, module: row.module, questionNumber: row.question_number, completedAt: row.completed_at_ms });
  }
  return json({ reviews: eligible });
}
async function preview(body2, env, session2, options, now, requestUrl) {
  if (!bodyHasExactly(body2, ["visitId", "route", "model", "locale", "currentMessage", "priorMessages"], ["reviewId", "includeVisuals"]) || typeof body2.visitId !== "string" || !UUID2.test(body2.visitId)) return invalid2();
  const provider = options.find((o) => o.route === body2.route && o.model === body2.model);
  if (!provider) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  if (!provider.healthy) return failure(503, "provider_error", "This Gemini route is unavailable. Try again later.");
  if (!provider.languages.includes(body2.locale)) return failure(400, "capability_missing", "This model does not support the selected response language.");
  let attached = null;
  if (body2.reviewId !== void 0) {
    if (typeof body2.reviewId !== "string" || typeof body2.includeVisuals !== "boolean") return invalid2();
    if (body2.includeVisuals && !provider.vision) return failure(409, "capability_missing", "Choose a vision-capable Gemini model before sharing visuals.");
    const found = await attachment(env, session2.account_id, body2.reviewId, body2.includeVisuals, requestUrl);
    if (found instanceof Response) return found;
    attached = found;
  }
  const payload = payloadOf(body2, attached);
  if (!payload) return invalid2();
  const key2 = await routeKey(env, session2.account_id, provider);
  if (!key2) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  const personal = await credential(env, session2.account_id);
  const secrets = [key2.key, sharedGeminiKey(env), personal ? await unseal(personal.ciphertext, env.ASSISTANT_KEY_KEK, `credential:${session2.account_id}`) : null];
  if (/(?:AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,}|-----BEGIN .*PRIVATE KEY-----)/.test(payload) || secrets.some((s) => s && payload.includes(s))) return failure(400, "blocked_content", "Remove credentials from the prompt and preview again.");
  if (!await reserve(env, `preview:${session2.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1e3), now);
  const snapshot2 = { id: crypto.randomUUID(), account: session2.account_id, session: session2.token_hash, visit: body2.visitId, expires: now + 5 * 6e4, provider, credentialVersion: key2.version, payload, tokens: estimateTokens(payload, attached?.visuals), ...attached ? { attachmentReviewId: attached.reviewId, attachmentVisuals: body2.includeVisuals === true, attachmentHash: await sha2564(JSON.stringify(attached)) } : {} };
  const previewId = await seal(JSON.stringify(snapshot2), env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, snapshot2.expires).run();
  return json2({ previewId, expiresAt: snapshot2.expires, provider, payload, visuals: attached?.visuals.map(({ width, height, alt, mimeType }) => ({ width, height, alt, mimeType })) ?? [], neverSent: ["Account profile", "Scores and Study Plan", "Decks", "Current question", "Source PDFs and paths", "Provider credentials and internal references", "Diagnostic logs"], retention: "This conversation ends on sign-out, reload, or closing this browser tab. It is not account history." });
}
async function send(body2, env, session2, options, adapter, now, requestUrl) {
  if (!bodyHasExactly(body2, ["previewId", "visitId", "consent"]) || body2.consent !== true || typeof body2.previewId !== "string" || typeof body2.visitId !== "string") return consentRequired();
  let snapshot2;
  try {
    snapshot2 = JSON.parse(await unseal(body2.previewId, env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview"));
  } catch {
    return consentRequired();
  }
  if (snapshot2.account !== session2.account_id || snapshot2.session !== session2.token_hash || snapshot2.visit !== body2.visitId || snapshot2.expires <= now) return consentRequired();
  const provider = options.find((o) => o.route === snapshot2.provider.route && o.model === snapshot2.provider.model);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot2.provider)) return consentRequired();
  const key2 = await routeKey(env, session2.account_id, provider);
  if (!key2 || key2.version !== snapshot2.credentialVersion) return consentRequired();
  if (snapshot2.attachmentReviewId) {
    const currentAttachment = await attachment(env, session2.account_id, snapshot2.attachmentReviewId, snapshot2.attachmentVisuals === true, requestUrl);
    if (currentAttachment instanceof Response) return currentAttachment;
    if (!snapshot2.attachmentHash || await sha2564(JSON.stringify(currentAttachment)) !== snapshot2.attachmentHash) return consentRequired();
  }
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, now).first();
  if (!consumed) return consentRequired();
  await env.DB.prepare("DELETE FROM assistant_limits WHERE window_ms < ?").bind(Math.floor(now / HOUR) * HOUR).run();
  const retry = Math.ceil((HOUR - now % HOUR) / 1e3);
  if (!await reserve(env, `send:${session2.account_id}`, snapshot2.tokens, 20, 8e4, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot2.tokens, 100, 4e5, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try {
    const text = await adapter(snapshot2.payload, provider.model, key2.key);
    if (!text.trim() || text.length > 8e3 || text.includes(key2.key) || /(?:AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,})/.test(text)) return failure(502, "blocked_content", "Gemini returned content that cannot be displayed.");
    return json2({ text, provider, verified: false });
  } catch (error) {
    const known = error instanceof GeminiFailure ? error : new GeminiFailure("provider_error", 10);
    if (known.code === "quota_exhausted" && provider.route === "shared_gemini") {
      await env.DB.prepare("UPDATE assistant_limits SET requests = 100 WHERE scope = 'shared' AND window_ms = ?").bind(Math.floor(now / HOUR) * HOUR).run();
      return rateLimitedResponse(known.code, retry, now);
    }
    const message2 = known.code === "credential_invalid" ? "Gemini API key is invalid or unauthorized. Please check AI Settings in your Account." : known.code === "model_unavailable" ? `The Gemini model (${provider.model}) is currently unavailable.` : known.code === "blocked_content" ? "Gemini returned content that cannot be displayed." : known.code === "timeout" ? "Gemini request timed out. Your draft is preserved." : known.message && known.message !== "provider_error" ? known.message : "Gemini could not complete this request. Your draft is preserved. Try sending again.";
    return Response.json({ error: { code: known.code, message: message2, ...known.retrySeconds ? { retryAt: now + known.retrySeconds * 1e3 } : {} } }, { status: known.code === "timeout" ? 504 : known.code === "quota_exhausted" ? 429 : 502, headers: { ...noStore, ...known.retrySeconds ? { "Retry-After": String(known.retrySeconds) } : {} } });
  }
}
async function planPreview(body2, request, env, session2, options, now) {
  if (!bodyHasExactly(body2, ["visitId", "route", "model", "locale", "official", "whitebook", "settings", "expectedVersionId"]) || typeof body2.visitId !== "string" || !UUID2.test(body2.visitId) || typeof body2.official !== "boolean" || typeof body2.whitebook !== "boolean" || !(body2.expectedVersionId === null || typeof body2.expectedVersionId === "string")) return invalid2();
  const provider = options.find((option) => option.route === body2.route && option.model === body2.model);
  if (!provider || !provider.healthy || !provider.languages.includes(body2.locale))
    return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  const selection = { official: body2.official, whitebook: body2.whitebook };
  const assembled = await planEnvelope(request, env, session2.account_id, now, selection, body2.settings);
  if (assembled instanceof Response) return assembled;
  const latest = await env.DB.prepare("SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1").bind(session2.account_id).first();
  if ((latest?.id ?? null) !== body2.expectedVersionId) return failure(409, "plan_changed", "Reload the latest Study Plan before previewing suggestions.");
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: `You are a Study Plan assistant. Respond in ${body2.locale === "vi" ? "Vietnamese" : "English"}. Return exactly one JSON array of 1 to 20 proposed tasks, with no markdown or extra prose. Each task must contain date, kind, title, minutes, action, and explanation. Use kind "cards" only when dueCardTotal is positive, with action {"area":"cards"}; or kind "practice" with action {"area":"practice","revisionId":"an activityCatalog revisionId","section":"its section"}. Select only real activityCatalog pairs. Do not propose review tasks because individual review links are not shared. The server's current study date is ${assembled.envelope.today}; schedule only on study days from that date (inclusive) through the day before ${assembled.envelope.primarySatTarget}. Stay within dailyMinutes. Never predict SAT point gains, invent packages or questions, or equate Whitebook Raw Accuracy with SAT points. Do not save the plan.` }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(assembled.envelope) }] }],
    generationConfig: generationConfigOf(provider.model, PLAN_OUTPUT)
  });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD) return failure(413, "too_large", "The selected evidence is too large to preview.");
  const key2 = await routeKey(env, session2.account_id, provider);
  if (!key2) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  if (!await reserve(env, `preview:${session2.account_id}`, 0, 60, 1, now))
    return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1e3), now);
  const snapshot2 = {
    id: crypto.randomUUID(),
    account: session2.account_id,
    session: session2.token_hash,
    visit: body2.visitId,
    expires: now + 5 * 6e4,
    provider,
    credentialVersion: key2.version,
    payload,
    tokens: new TextEncoder().encode(payload).length + PLAN_OUTPUT,
    flow: "plan",
    plan: { selection, settings: assembled.settings, expectedVersionId: body2.expectedVersionId, envelope: assembled.envelope }
  };
  const previewId = await seal(JSON.stringify(snapshot2), env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, snapshot2.expires).run();
  return json2({ previewId, expiresAt: snapshot2.expires, provider, payload, content: assembled.envelope });
}
async function planSend(body2, request, env, session2, options, adapter, now) {
  if (!bodyHasExactly(body2, ["previewId", "visitId", "consent"]) || body2.consent !== true || typeof body2.previewId !== "string" || typeof body2.visitId !== "string") return consentRequired();
  let snapshot2;
  try {
    snapshot2 = JSON.parse(await unseal(body2.previewId, env.ASSISTANT_SNAPSHOT_KEY, "tutor-preview"));
  } catch {
    return consentRequired();
  }
  if (snapshot2.flow !== "plan" || !snapshot2.plan || snapshot2.account !== session2.account_id || snapshot2.session !== session2.token_hash || snapshot2.visit !== body2.visitId || snapshot2.expires <= now) return consentRequired();
  const provider = options.find((option) => option.route === snapshot2.provider.route && option.model === snapshot2.provider.model);
  const key2 = provider && await routeKey(env, session2.account_id, provider);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot2.provider) || !key2 || key2.version !== snapshot2.credentialVersion) return consentRequired();
  const current = await planEnvelope(request, env, session2.account_id, now, snapshot2.plan.selection, snapshot2.plan.settings);
  if (current instanceof Response || JSON.stringify(current.envelope) !== JSON.stringify(snapshot2.plan.envelope)) return consentRequired();
  const latest = await env.DB.prepare("SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1").bind(session2.account_id).first();
  if ((latest?.id ?? null) !== snapshot2.plan.expectedVersionId) return consentRequired();
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot2.id, session2.account_id, session2.token_hash, body2.visitId, now).first();
  if (!consumed) return consentRequired();
  const retry = Math.ceil((HOUR - now % HOUR) / 1e3);
  if (!await reserve(env, `send:${session2.account_id}`, snapshot2.tokens, 20, 8e4, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot2.tokens, 100, 4e5, now))
    return rateLimitedResponse("quota_exhausted", retry, now);
  let text;
  try {
    text = await adapter(snapshot2.payload, provider.model, key2.key);
  } catch {
    return failure(502, "provider_error", "Study Plan suggestions are unavailable. Your saved plan remains available.");
  }
  if (text.includes(key2.key)) return failure(502, "provider_error", "Study Plan suggestions are unavailable. Your saved plan remains available.");
  const proposals = parseProposals(text);
  if (!proposals) return failure(422, "invalid_suggestions", "Gemini returned invalid Study Plan suggestions. Your saved plan remains available.");
  const validated = validateProposals(
    proposals,
    snapshot2.plan.settings,
    current.context,
    await completedReviewKeys(env, session2.account_id)
  );
  if (validated instanceof Response) return validated;
  const proposal = {
    id: crypto.randomUUID(),
    account: session2.account_id,
    session: session2.token_hash,
    visit: body2.visitId,
    expires: now + 5 * 6e4,
    selection: snapshot2.plan.selection,
    settings: snapshot2.plan.settings,
    expectedVersionId: snapshot2.plan.expectedVersionId,
    envelope: snapshot2.plan.envelope,
    proposals
  };
  const proposalId = await seal(JSON.stringify(proposal), env.ASSISTANT_SNAPSHOT_KEY, "plan-proposal");
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(proposal.id, session2.account_id, session2.token_hash, body2.visitId, proposal.expires).run();
  return json2({ proposalId, expiresAt: proposal.expires, tasks: validated, provider });
}
async function planAccept(body2, request, env, session2, now) {
  if (!bodyHasExactly(body2, ["proposalId", "visitId"]) || typeof body2.proposalId !== "string" || typeof body2.visitId !== "string") return invalid2();
  let proposal;
  try {
    proposal = JSON.parse(await unseal(body2.proposalId, env.ASSISTANT_SNAPSHOT_KEY, "plan-proposal"));
  } catch {
    return consentRequired();
  }
  if (proposal.account !== session2.account_id || proposal.session !== session2.token_hash || proposal.visit !== body2.visitId || proposal.expires <= now)
    return consentRequired();
  return acceptProposals(
    request,
    env,
    session2.account_id,
    now,
    proposal.id,
    proposal.expectedVersionId,
    proposal.selection,
    proposal.settings,
    proposal.envelope,
    proposal.proposals
  );
}
async function testModels(body2, env, session2, options, adapter, now) {
  const requestedRoute = body2.route === "personal_gemini" ? "personal_gemini" : "shared_gemini";
  let targetOption = options.find((o) => o.route === requestedRoute);
  if (!targetOption && options.length > 0) {
    targetOption = options[0];
  }
  if (!targetOption) {
    return failure(503, "provider_error", "No configured Gemini routes are available.");
  }
  const key2 = await routeKey(env, session2.account_id, targetOption);
  if (!key2) {
    return failure(409, "credential_required", requestedRoute === "personal_gemini" ? "Personal Gemini credential is not configured." : "Shared Gemini route is unavailable.");
  }
  const modelsToTest = Array.from(/* @__PURE__ */ new Set([
    ...GEMINI_CANDIDATE_MODELS,
    ...options.map((o) => o.model).filter((m) => !m.includes("test"))
  ]));
  const results = [];
  for (const model of modelsToTest) {
    const start3 = Date.now();
    const testPayload = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: generationConfigOf(model, 128)
    });
    try {
      await adapter(testPayload, model, key2.key, 8e3);
      const latencyMs = Date.now() - start3;
      results.push({ model, working: true, status: 200, latencyMs });
    } catch (err) {
      const latencyMs = Date.now() - start3;
      const failure2 = err instanceof GeminiFailure ? err : null;
      let errorDesc = failure2?.message || (err instanceof Error ? err.message : "Unavailable");
      let status = 502;
      if (failure2?.code === "quota_exhausted") status = 429;
      else if (failure2?.code === "timeout") status = 504;
      else if (failure2?.code === "model_unavailable") status = 404;
      else if (failure2?.code === "credential_invalid") status = 401;
      else if (errorDesc.toLowerCase().includes("high demand")) status = 503;
      results.push({ model, working: false, status, latencyMs, error: errorDesc });
    }
  }
  const working = results.filter((r) => r.working);
  const recommendedModel = working.length > 0 ? working.sort((a, b) => a.latencyMs - b.latencyMs)[0].model : null;
  return json2({
    route: targetOption.route,
    models: results,
    recommendedModel,
    testedAt: now
  });
}
function assistantRoute(request, env, adapter = geminiAdapter, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/assistant/")) return null;
  return (async () => {
    if (env.AI_RELEASE_ENABLED !== "true") return failure(404, "ai_disabled", "Tutor Chat is not available in this release.");
    const session2 = await currentSession(request, env);
    if (!session2) return failure(401, "signed_out", "Sign in to open Tutor Chat.");
    if (request.method !== "GET") {
      const denied = await requireMutation(request, env, session2);
      if (denied) return denied;
    }
    const time = now();
    if (request.method === "POST" && path === "/api/assistant/plan-accept") {
      const body3 = await bodyOf(request);
      if (!body3) return invalid2();
      return planAccept(body3, request, env, session2, time);
    }
    const options = catalog(env, time).filter((option) => option.route !== "shared_gemini" || !!sharedGeminiKey(env));
    if (!options.length) return failure(503, "eligibility_required", "Tutor Chat is awaiting a current provider eligibility and failure review.");
    if (request.method === "GET" && path === "/api/assistant/options") {
      const saved = await credential(env, session2.account_id);
      return json2({ options, credential: saved ? { lastFour: saved.last_four } : null, limits: { priorMessages: 8, promptCharacters: 4e3, outputTokens: MAX_OUTPUT, requestsPerHour: 20, reservedTokensPerHour: 8e4 } });
    }
    if (request.method === "GET" && path === "/api/assistant/attachments") return attachmentList(env, session2.account_id);
    if (request.method !== "POST") return failure(405, "method_not_allowed", "This Tutor Chat action is unavailable.");
    const body2 = await bodyOf(request, path === "/api/assistant/send" ? MAX_SEND_BODY_BYTES : 7e4);
    if (!body2) return invalid2();
    if (path === "/api/assistant/test-models") return testModels(body2, env, session2, options, adapter, time);
    if (path === "/api/assistant/preview") return preview(body2, env, session2, options, time, request.url);
    if (path === "/api/assistant/reasoning-preview") return reasoningPreview(body2, env, session2, options, time);
    if (path === "/api/assistant/send") return send(body2, env, session2, options, adapter, time, request.url);
    if (path === "/api/assistant/reasoning-send") return reasoningSend(body2, env, session2, options, adapter, time);
    if (path === "/api/assistant/flashcards-preview") return flashcardPreview(body2, env, session2, options, time);
    if (path === "/api/assistant/flashcards-send") return flashcardSend(body2, env, session2, options, adapter, time);
    if (path === "/api/assistant/plan-preview") return planPreview(body2, request, env, session2, options, time);
    if (path === "/api/assistant/plan-send") return planSend(body2, request, env, session2, options, adapter, time);
    if (path === "/api/assistant/credential") {
      if (!bodyHasExactly(body2, ["key"]) || typeof body2.key !== "string" || !/^[A-Za-z0-9_.-]{20,256}$/.test(body2.key)) return invalid2();
      const encrypted = await seal(body2.key, env.ASSISTANT_KEY_KEK, `credential:${session2.account_id}`);
      await env.DB.prepare("INSERT INTO assistant_credentials (account_id, version, ciphertext, last_four) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET version = excluded.version, ciphertext = excluded.ciphertext, last_four = excluded.last_four").bind(session2.account_id, crypto.randomUUID(), encrypted, body2.key.slice(-4)).run();
      return json2({ lastFour: body2.key.slice(-4) });
    }
    if (path === "/api/assistant/credential/remove" && bodyHasExactly(body2, [])) {
      await env.DB.prepare("DELETE FROM assistant_credentials WHERE account_id = ?").bind(session2.account_id).run();
      return json2({ removed: true });
    }
    return failure(404, "not_found", "This Tutor Chat action is unavailable.");
  })();
}

// hosted/src/worker.ts
var QUESTION_PATH = /^\/api\/staging\/questions\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;
var CONTENT_PATH = /^\/content\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.svg)$/;
var PUBLIC_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2?|ttf)$/;
var PUBLIC_DESIGN_IMAGE = /^\/assets\/(?:study-illustration|paper)-[A-Za-z0-9_-]+\.(?:png|webp)$/;
var SESSION_SECONDS2 = 30 * 60;
async function one(env, meter, sql, ...values) {
  const result = await env.DB.prepare(sql).bind(...values).all();
  meter.rowsRead += result.meta.rows_read;
  meter.rowsWritten += result.meta.rows_written;
  return result.results[0] ?? null;
}
function measured(response, meter) {
  const headers = new Headers(response.headers);
  headers.set("X-Staging-D1-Rows-Read", String(meter.rowsRead));
  headers.set("X-Staging-D1-Rows-Written", String(meter.rowsWritten));
  return new Response(response.body, { status: response.status, headers });
}
function closed(status = 404) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
  });
}
async function sha2565(value) {
  const bytes2 = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes2);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function matchesCode(value, expected) {
  const [left, right] = await Promise.all([sha2565(value), sha2565(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function cookieToken(request) {
  const cookie2 = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)wb_staging=([a-f0-9]{64})(?:;|$)/.exec(cookie2);
  return match?.[1] ?? null;
}
async function authorized(request, env, meter) {
  const token = cookieToken(request);
  if (!token) return false;
  const row = await one(
    env,
    meter,
    "SELECT token_hash FROM staging_sessions WHERE token_hash = ? AND expires_at > ?",
    await sha2565(token),
    Math.floor(Date.now() / 1e3)
  );
  return row !== null;
}
async function session(request, env, meter) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return closed(403);
  if (!env.STAGING_ACCESS_CODE) return closed(503);
  let accessCode;
  try {
    const body2 = await request.text();
    if (body2.length > 1024) return closed(413);
    accessCode = JSON.parse(body2).accessCode;
  } catch {
    return closed(400);
  }
  if (typeof accessCode !== "string" || !await matchesCode(accessCode, env.STAGING_ACCESS_CODE))
    return closed(401);
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  const expiresAt = Math.floor(Date.now() / 1e3) + SESSION_SECONDS2;
  const result = await env.DB.prepare(
    "INSERT INTO staging_sessions (token_hash, expires_at) VALUES (?, ?)"
  ).bind(await sha2565(token), expiresAt).run();
  meter.rowsRead += result.meta.rows_read;
  meter.rowsWritten += result.meta.rows_written;
  if (!result.success) return closed(503);
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `wb_staging=${token}; Path=/; Max-Age=${SESSION_SECONDS2}; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "private, no-store"
    }
  });
}
async function question2(request, env, meter, revisionId, questionId) {
  if (!await authorized(request, env, meter)) return closed();
  const row = await one(
    env,
    meter,
    "SELECT revision_id, presentation_json FROM fixture_questions WHERE revision_id = ? AND question_id = ?",
    revisionId,
    questionId
  );
  if (!row) return closed();
  return Response.json(
    { revisionId: row.revision_id, questionId, presentation: JSON.parse(row.presentation_json) },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }
  );
}
async function content(request, env, meter, revisionId, questionId, name) {
  if (!await authorized(request, env, meter)) return closed();
  const path = `/content/${revisionId}/${questionId}/${name}`;
  const row = await one(
    env,
    meter,
    "SELECT path, content_type FROM fixture_assets WHERE path = ? AND revision_id = ? AND question_id = ?",
    path,
    revisionId,
    questionId
  );
  if (!row || row.path !== path || row.content_type !== "image/svg+xml") return closed();
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return closed();
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", row.content_type);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(asset.body, { status: 200, headers });
}
var worker_default = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && (path === "/" || path === "/app" || path === "/app.html"))
      return new Response(null, { status: 302, headers: { Location: new URL("/dashboard", request.url).toString(), "Cache-Control": "private, no-store" } });
    if (request.method === "GET" && path === "/dashboard") {
      const asset = await env.ASSETS.fetch(new Request(new URL("/app", request.url), request));
      const headers = new Headers(asset.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (request.method === "GET" && (path === "/staging" || path === "/staging.html" || PUBLIC_ASSET_PATH.test(path) || PUBLIC_DESIGN_IMAGE.test(path)))
      return env.ASSETS.fetch(request);
    const meter = { rowsRead: 0, rowsWritten: 0 };
    try {
      const assistantResponse = assistantRoute(request, env);
      if (assistantResponse) return await assistantResponse;
      const scoresResponse = scoresRoute(request, env);
      if (scoresResponse) return await scoresResponse;
      const progressResponse = progressRoute(request, env);
      if (progressResponse) return await progressResponse;
      const planResponse = planRoute(request, env);
      if (planResponse) return await planResponse;
      const satResponse = satDateRoute(request, env);
      if (satResponse) return await satResponse;
      const accountDataResponse = accountDataRoute(request, env);
      if (accountDataResponse) return await accountDataResponse;
      const remindersResponse = remindersRoute(request, env);
      if (remindersResponse) return await remindersResponse;
      const accountResponse = accountRoute(request, env);
      if (accountResponse) return await accountResponse;
      const studyResponse = studyRoute(request, env);
      if (studyResponse) return await studyResponse;
      const cardsResponse = cardRoute(request, env);
      if (cardsResponse) return await cardsResponse;
      const libraryResponse = libraryRoute(request, env);
      if (libraryResponse) return await libraryResponse;
      const mathResponse = mathToolsRoute(request, env);
      if (mathResponse) return await mathResponse;
      const attemptsResponse = attemptRoute(request, env);
      if (attemptsResponse) return await attemptsResponse;
      const reviewResponse = reviewRoute(request, env);
      if (reviewResponse) return await reviewResponse;
      if (request.method === "POST" && path === "/api/staging/session")
        return measured(await session(request, env, meter), meter);
      const questionMatch = request.method === "GET" && QUESTION_PATH.exec(path);
      if (questionMatch) return measured(await question2(request, env, meter, questionMatch[1], questionMatch[2]), meter);
      const contentMatch = request.method === "GET" && CONTENT_PATH.exec(path);
      if (contentMatch) return measured(await content(request, env, meter, contentMatch[1], contentMatch[2], contentMatch[3]), meter);
    } catch {
      if (path.startsWith("/api/assistant/") || path.startsWith("/api/account/") || path.startsWith("/api/auth/") || path.startsWith("/api/reminders") || path.startsWith("/api/cards/") || path.startsWith("/api/library") || path.startsWith("/api/attempts") || path.startsWith("/api/review/") || path.startsWith("/api/math/") || path.startsWith("/content/"))
        return Response.json(
          { error: { code: "service_unavailable", message: "Whitebook could not reach your account. Try again." } },
          { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }
        );
      return closed(503);
    }
    return closed();
  }
};
export {
  worker_default as default
};
