"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var InfiniteChecker = /** @class */ (function () {
    function InfiniteChecker(maxIterations) {
        this.maxIterations = maxIterations;
        this.count = 0;
    }
    InfiniteChecker.prototype.check = function () {
        this.count += 1;
        if (this.count > this.maxIterations) {
            throw new Error("Infinite loop detected - reached max iterations");
        }
    };
    return InfiniteChecker;
}());
exports.InfiniteChecker = InfiniteChecker;
//# sourceMappingURL=infinite-checker.js.map