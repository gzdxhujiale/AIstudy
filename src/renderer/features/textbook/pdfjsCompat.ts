type UpsertMapPrototype = Map<unknown, unknown> & {
  getOrInsert?: (key: unknown, value: unknown) => unknown;
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};

const mapPrototype = Map.prototype as UpsertMapPrototype;

if (typeof mapPrototype.getOrInsert !== "function") {
  Object.defineProperty(mapPrototype, "getOrInsert", {
    configurable: true,
    writable: true,
    value(this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    }
  });
}

if (typeof mapPrototype.getOrInsertComputed !== "function") {
  Object.defineProperty(mapPrototype, "getOrInsertComputed", {
    configurable: true,
    writable: true,
    value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    }
  });
}
