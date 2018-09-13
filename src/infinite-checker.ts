export class InfiniteChecker {

  public maxIterations;
  public count;

  constructor(maxIterations) {
    this.maxIterations = maxIterations;
    this.count = 0;
  }

  public check() {
    this.count += 1;
    if (this.count > this.maxIterations) {
      throw new Error("Infinite loop detected - reached max iterations");
    }
  }
}
