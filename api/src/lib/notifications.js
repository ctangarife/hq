/**
 * Sistema de Notificaciones SSE (Server-Sent Events)
 * Para comunicación en tiempo real con el frontend
 */

class SSEManager {
  constructor() {
    this.clients = new Map(); // Map de clientId -> Response object
  }

  /**
   * Registra un nuevo cliente SSE
   */
  addClient(req, res) {
    const clientId = req.query.clientId || `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[SSE] Cliente conectado: ${clientId}`);

    // Configurar headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Enviar comentario inicial de conexión
    res.write(`: connected\n\n`);

    // Guardar referencia al response
    this.clients.set(clientId, res);

    // Manejar desconexión del cliente
    req.on('close', () => {
      console.log(`[SSE] Cliente desconectado: ${clientId}`);
      this.clients.delete(clientId);
    });

    return clientId;
  }

  /**
   * Envía un evento a todos los clientes conectados
   */
  broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;

    for (const [clientId, res] of this.clients.entries()) {
      try {
        res.write(data);
      } catch (error) {
        console.error(`[SSE] Error enviando a ${clientId}:`, error.message);
        // Remover cliente con error
        this.clients.delete(clientId);
      }
    }

    console.log(`[SSE] Broadcast: ${event.type} - ${event.action || ''} (${this.clients.size} clientes)`);
  }

  /**
   * Envía un evento a un cliente específico
   */
  sendToClient(clientId, event) {
    const res = this.clients.get(clientId);
    if (!res) {
      console.error(`[SSE] Cliente ${clientId} no encontrado`);
      return;
    }

    const data = `data: ${JSON.stringify(event)}\n\n`;

    try {
      res.write(data);
    } catch (error) {
      console.error(`[SSE] Error enviando a ${clientId}:`, error.message);
      this.clients.delete(clientId);
    }
  }

  /**
   * Desconecta un cliente específico
   */
  disconnectClient(clientId) {
    const res = this.clients.get(clientId);
    if (res) {
      try {
        res.end();
      } catch (error) {
        console.error(`[SSE] Error desconectando ${clientId}:`, error.message);
      }
      this.clients.delete(clientId);
    }
  }

  /**
   * Obtiene estadísticas de conexiones
   */
  getStats() {
    return {
      totalClients: this.clients.size,
      clientIds: Array.from(this.clients.keys())
    };
  }

  /**
   * Desconecta todos los clientes
   */
  disconnectAll() {
    console.log(`[SSE] Desconectando ${this.clients.size} clientes`);
    for (const [clientId, res] of this.clients.entries()) {
      try {
        res.end();
      } catch (error) {
        console.error(`[SSE] Error desconectando ${clientId}:`, error.message);
      }
    }
    this.clients.clear();
  }
}

// Instancia global del gestor SSE
export const sseManager = new SSEManager();

export { SSEManager };
