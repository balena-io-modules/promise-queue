promise-queue
===

This module allows you to queue sync/async functions with max concurrency, max size, max-age, and fifo/lifo ordering

### Constructor

```
let q = new PromiseQueue({
  name: 'device_logs',
  concurrency: 40,
  maxSize: 400,
  maxAge: 30 * 1000,
  order: 'fifo'
});
```

### Use

```
export function middleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	q.add(() =>
          new Promise(resolve => {
              res.once('close', resolve);
              res.once('finish', resolve);
              next();
          }),
      )
      .catch(err => {
          if (err instanceof PromiseQueueError) {
              reject(res);
          }
      });
}
```

### Metrics

`PromiseQueue.metrics` is an `EventEmitter` which emits the following events:

- `arrival`, data: `undefined`: a promise arrives at the queue
- `queueLength`, data: `number`: the length of the queue on arrival
- `inFlight`, data: `number`: the number of active promises on arrival

- `dequeue`, data: `undefined`: a promise stops waiting in the queue and starts processing
- `queueTime`, data: `number`: time a promise spent waiting in queue on dequeue

- `completion`, data: `undefined`: a promise completes processing
- `serviceTime`, data: `number`: time a promise spent processing on completion
- `latency`, data: `number`: sum of queueTime and serviceTime on completion

- `rejection`, data: `undefined`: a promise to be added is rejected because `maxSize` is already reached
- `timeout`, data: `undefined`: a promise's latency (queue time + service time) exceeds `maxAge`, and it is rejected
