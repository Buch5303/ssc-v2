import { getDenialListener } from '@/lib/db/listeners';
import { DenialSpikeDetector } from '@/lib/metrics/denial-spike-detector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface DenialEvent {
  id: string;
  user_id: string;
  resource: string;
  timestamp: string;
  outcome: string;
}

export async function GET() {
  const encoder = new TextEncoder();
  const listener = getDenialListener();
  const detector = new DenialSpikeDetector();
  
  // Ensure listener is connected
  try {
    await listener.connect();
  } catch (error) {
    console.error('Failed to connect denial listener:', error);
    return new Response('Failed to establish real-time connection', { status: 500 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let heartbeatInterval: NodeJS.Timeout;
      let isClosed = false;

      // Handle denial events
      const handleDenial = (event: DenialEvent) => {
        if (isClosed) return;
        
        const startTime = Date.now();
        
        // Only process events with outcome='deny'
        if (event.outcome !== 'deny') {
          return;
        }

        try {
          // Record event and check for spike
          detector.record(event);
          
          // Enqueue denial event
          const denialData = {
            audit_row_id: event.id,
            user_id: event.user_id,
            resource: event.resource,
            timestamp: event.timestamp
          };
          
          const denialFrame = `event: denial\ndata: ${JSON.stringify(denialData)}\n\n`;
          controller.enqueue(encoder.encode(denialFrame));
          
          // Check for spike and enqueue spike event if needed
          if (detector.isSpiking()) {
            const spikePayload = detector.getSpikePayload();
            const spikeFrame = `event: spike\ndata: ${JSON.stringify(spikePayload)}\n\n`;
            controller.enqueue(encoder.encode(spikeFrame));
          }
          
          // Log latency warning if > 300ms
          const latency = Date.now() - startTime;
          if (latency > 300) {
            console.warn(`SSE denial event latency exceeded 300ms: ${latency}ms`);
          }
        } catch (error) {
          console.error('Error processing denial event:', error);
        }
      };

      // Set up event listener
      listener.on('denial', handleDenial);
      
      // Set up heartbeat
      heartbeatInterval = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch (error) {
          // Stream may be closed, ignore
        }
      }, 15000);

      // Cleanup function
      const cleanup = () => {
        isClosed = true;
        clearInterval(heartbeatInterval);
        // Remove only this connection's listener
        listener.removeListener('denial', handleDenial);
      };

      // Handle stream close
      const handleClose = () => {
        cleanup();
        try {
          controller.close();
        } catch (error) {
          // Stream may already be closed
        }
      };

      // Set up abort signal handling
      if (controller.signal) {
        controller.signal.addEventListener('abort', handleClose);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive'
    }
  });
}