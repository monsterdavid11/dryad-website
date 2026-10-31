import {
  createHash,
  randomBytes,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export const failure = (status, message) =>
  Object.assign(new Error(message), { status });
export function signer(pem) {
  const key = createPrivateKey(pem),
    publicKey = createPublicKey(key),
    kid = digest(publicKey.export({ type: "spki", format: "der" })).slice(
      0,
      16,
    );
  if (
    key.asymmetricKeyType !== "rsa" ||
    key.asymmetricKeyDetails.modulusLength < 2048
  )
    throw new Error(
      "Dryad requires an RSA signing key with at least 2048 bits.",
    );
  return {
    kid,
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    sign(payload) {
      const header = Buffer.from(
          JSON.stringify({ alg: "RS256", typ: "JWT", kid }),
        ).toString("base64url"),
        body = Buffer.from(JSON.stringify(payload)).toString("base64url"),
        input = `${header}.${body}`;
      return `${input}.${sign("sha256", Buffer.from(input), key).toString("base64url")}`;
    },
  };
}
export function installationKey(encoded) {
  try {
    const key = createPublicKey({
      key: Buffer.from(encoded, "base64"),
      type: "spki",
      format: "der",
    });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails.namedCurve !== "prime256v1"
    )
      throw Error();
    return key;
  } catch {
    throw failure(400, "Use a valid P-256 installation public key.");
  }
}
export function proof(key, message, signature) {
  try {
    return (
      typeof signature === "string" &&
      signature.length < 256 &&
      verify(
        "sha256",
        Buffer.from(message),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      )
    );
  } catch {
    return false;
  }
}
