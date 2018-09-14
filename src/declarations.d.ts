declare module "hoister" {
    const hoist: (ast: object) => object;
    export = hoist;
}

declare var global;
