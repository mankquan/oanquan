# Deploy notes

This version uses an in-memory WebSocket room registry. Configure `ROOM_CAPACITY` from 2 to 30 (default 30); the application hard-limits itself to 4 rooms. The nominal maximum is 120 concurrent players, but actual capacity depends on the host CPU, RAM, network and browser rendering load. Run a load test before public launch.

For production, use HTTPS/WSS, process supervision, monitoring, and a shared store (for example Redis) if deploying multiple server instances. Current room membership and chat are not persisted and reset when the Node process restarts.
