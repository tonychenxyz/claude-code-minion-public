---
name: vllm
description: Best practices for using vLLM inference server for batch generation
---

# vLLM Usage Best Practices

## Key Principle: Send ALL Requests at Once with Concurrency Control

**vLLM handles batching internally.** Do NOT implement manual batching in your client code.
However, you MUST use a semaphore to limit concurrent requests to avoid overwhelming the Python asyncio event loop.

### Why?

- vLLM has its own internal scheduler that efficiently batches requests
- vLLM uses continuous batching to maximize GPU utilization
- Manual batching adds unnecessary latency and complexity
- BUT: Creating 50,000+ coroutines can overwhelm Python's asyncio (99% CPU managing coroutines, 0% GPU usage)
- Solution: Use a semaphore to limit concurrent requests (e.g., 500) while still sending all at once

### How to Use

```python
import asyncio
from openai import AsyncOpenAI

MAX_CONCURRENT = 500  # Limit concurrent requests

async def process_all(items: list, client: AsyncOpenAI):
    """Send ALL requests to vLLM with semaphore-controlled concurrency."""

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def process_single(item):
        async with semaphore:  # Limits concurrent requests
            response = await client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": item["prompt"]}],
                max_tokens=MAX_TOKENS,
                temperature=TEMPERATURE,
            )
            return response.choices[0].message.content

    # Create ALL tasks at once - semaphore limits actual concurrent API calls
    tasks = [process_single(item) for item in items]
    results = await asyncio.gather(*tasks)
    return results
```

### DON'T Do This

```python
# BAD - Manual batching adds unnecessary overhead
for batch_start in range(0, total, batch_size):
    batch = items[batch_start:batch_start + batch_size]
    for item in batch:
        result = await process_single(item)
        results.append(result)

# ALSO BAD - No concurrency limit with huge number of tasks
# This can overwhelm asyncio event loop!
tasks = [process_single(item) for item in items]  # 50,000 coroutines
results = await asyncio.gather(*tasks)  # Python spends 100% CPU managing coroutines
```

### DO This Instead

```python
# GOOD - Semaphore limits concurrent requests while still sending all at once
semaphore = asyncio.Semaphore(500)

async def process_single(item):
    async with semaphore:
        # API call here
        pass

tasks = [process_single(item) for item in items]
results = await asyncio.gather(*tasks)
```

## vLLM Server Configuration

When starting vLLM server, consider these options for large batch workloads:

```bash
python -m vllm.entrypoints.openai.api_server \
    --model $MODEL_PATH \
    --port 8000 \
    --tensor-parallel-size 1 \
    --max-model-len 16384 \      # Increase if using large max_tokens
    --gpu-memory-utilization 0.9  # Use most of GPU memory
```

## Handling Large max_tokens

If you get error: `max_tokens is too large: X. This model's maximum context length is Y`

Solution: Increase `--max-model-len` when starting vLLM server:
```bash
--max-model-len 16384  # or higher as needed
```

The model's context window must be >= prompt_tokens + max_tokens.
