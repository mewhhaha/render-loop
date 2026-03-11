export class JobQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.pending = [];
  }

  enqueue(run) {
    return new Promise((resolve, reject) => {
      this.pending.push({ run, resolve, reject });
      this.#drain();
    });
  }

  stats() {
    return {
      concurrency: this.concurrency,
      running: this.running,
      queued: this.pending.length,
    };
  }

  #drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.running += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this.#drain();
        });
    }
  }
}
