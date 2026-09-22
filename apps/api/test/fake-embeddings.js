"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerError = exports.FakeEmbeddingClient = exports.DIMENSIONS = void 0;
exports.fakeVector = fakeVector;
const node_crypto_1 = require("node:crypto");
exports.DIMENSIONS = 768;
function fakeVector(text) {
    const v = new Array(exports.DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const bucket = (0, node_crypto_1.createHash)("sha256").update(word).digest().readUInt16BE(0) % exports.DIMENSIONS;
        v[bucket] += 1;
    }
    const length = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    if (length === 0)
        v[0] = 1;
    return length === 0 ? v : v.map((x) => x / length);
}
class FakeEmbeddingClient {
    model = "fake-embedding";
    dimensions = exports.DIMENSIONS;
    setupId = "fake-embedding|768|w1";
    calls = [];
    failures = [];
    beforeCall;
    async embed(texts, purpose) {
        const call = { texts: [...texts], purpose };
        this.calls.push(call);
        await this.beforeCall?.(call);
        const failure = this.failures.shift();
        if (failure)
            throw failure;
        return texts.map(fakeVector);
    }
    get textsSent() {
        return this.calls.flatMap((c) => c.texts);
    }
    reset() {
        this.calls = [];
        this.failures = [];
        this.beforeCall = undefined;
        this.setupId = "fake-embedding|768|w1";
    }
}
exports.FakeEmbeddingClient = FakeEmbeddingClient;
const providerError = (status, message = `provider error ${status}`) => Object.assign(new Error(message), { status });
exports.providerError = providerError;
//# sourceMappingURL=fake-embeddings.js.map