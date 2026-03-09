/**
 * Transform registry interface
 */
export class TransformRegistry {
    constructor() {
        this.transforms = new Map();
        this.responseTransforms = new Map();
    }
    registerRequestTransform(name, transform) {
        this.transforms.set(name, transform);
    }
    registerResponseTransform(name, transform) {
        this.responseTransforms.set(name, transform);
    }
    getRequestTransform(name) {
        const transform = this.transforms.get(name);
        if (!transform) {
            throw new Error(`Request transform not found: ${name}`);
        }
        return transform;
    }
    getResponseTransform(name) {
        const transform = this.responseTransforms.get(name);
        if (!transform) {
            throw new Error(`Response transform not found: ${name}`);
        }
        return transform;
    }
}
export function createTransformRegistry() {
    return new TransformRegistry();
}
//# sourceMappingURL=transform.js.map