import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

// Configuração CORS mais permissiva
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Configuração do Neon DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Testar conexão com o banco
pool.on('connect', () => {
  console.log('✅ Conectado ao banco de dados Neon');
});

pool.on('error', (err) => {
  console.error('❌ Erro na conexão com o banco:', err);
});

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso necessário' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'super_segredo_jwt_altere_isto_123', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

// Rota de health check melhorada
app.get('/api/health', async (req, res) => {
  try {
    // Testar conexão com o banco
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'Disconnected',
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Rota para livros em destaque (NOVA)
app.get('/api/books/featured', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM books ORDER BY created_at DESC LIMIT 8'
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar livros em destaque:', error);
    res.status(500).json({ error: 'Erro ao buscar livros em destaque' });
  }
});

// Rotas de Autenticação
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Tentativa de login:', email);
    
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    
    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'super_segredo_jwt_altere_isto_123',
      { expiresIn: '24h' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        favorites: user.favorites || []
      },
      token
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    console.log('📝 Tentativa de cadastro:', email);
    
    // Verificar se usuário já existe
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Usuário já existe' });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, favorites) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, name, email, favorites`,
      [name, email, hashedPassword, []]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'super_segredo_jwt_altere_isto_123',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        favorites: user.favorites
      },
      token
    });
  } catch (error) {
    console.error('Erro no cadastro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rotas de Livros
app.get('/api/books', async (req, res) => {
  try {
    const { page = 1, limit = 12, search, category } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM books WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) FROM books WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (title ILIKE $${paramCount} OR author ILIKE $${paramCount} OR publisher ILIKE $${paramCount})`;
      countQuery += ` AND (title ILIKE $${paramCount} OR author ILIKE $${paramCount} OR publisher ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (category && category !== 'all') {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      countQuery += ` AND category = $${paramCount}`;
      params.push(category);
    }

    query += ` ORDER BY title LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), offset);

    const [booksResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, -2))
    ]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    res.json({
      items: booksResult.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages
    });
  } catch (error) {
    console.error('Erro ao buscar livros:', error);
    res.status(500).json({ error: 'Erro ao buscar livros' });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar livro:', error);
    res.status(500).json({ error: 'Erro ao buscar livro' });
  }
});

// Rotas do Carrinho
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar ou criar carrinho
    let cartResult = await pool.query(
      'SELECT * FROM carts WHERE user_id = $1',
      [userId]
    );

    let cart;
    if (cartResult.rows.length === 0) {
      const newCart = await pool.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING *',
        [userId]
      );
      cart = newCart.rows[0];
    } else {
      cart = cartResult.rows[0];
    }

    // Buscar itens do carrinho
    const itemsResult = await pool.query(
      `SELECT ci.*, b.* 
       FROM cart_items ci 
       JOIN books b ON ci.book_id = b.id 
       WHERE ci.cart_id = $1`,
      [cart.id]
    );

    const subtotal = itemsResult.rows.reduce((sum, item) => 
      sum + (parseFloat(item.price) * item.quantity), 0
    );
    const shipping = subtotal > 100 ? 0 : 12.90;
    const total = subtotal + shipping;

    // Atualizar totais do carrinho
    await pool.query(
      'UPDATE carts SET subtotal = $1, shipping = $2, total = $3 WHERE id = $4',
      [subtotal, shipping, total, cart.id]
    );

    res.json({
      id: cart.id,
      items: itemsResult.rows.map(item => ({
        id: item.id,
        book: {
          id: item.book_id,
          title: item.title,
          author: item.author,
          price: parseFloat(item.price),
          image_url: item.image_url,
          condition: item.condition,
          stock: item.stock
        },
        quantity: item.quantity
      })),
      subtotal,
      shipping,
      total
    });
  } catch (error) {
    console.error('Erro ao buscar carrinho:', error);
    res.status(500).json({ error: 'Erro ao buscar carrinho' });
  }
});

app.post('/api/cart/items', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookId, quantity = 1 } = req.body;

    // Verificar estoque
    const bookResult = await pool.query(
      'SELECT * FROM books WHERE id = $1',
      [bookId]
    );

    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    const book = bookResult.rows[0];
    if (book.stock < quantity) {
      return res.status(400).json({ error: 'Estoque insuficiente' });
    }

    // Buscar carrinho
    let cartResult = await pool.query(
      'SELECT * FROM carts WHERE user_id = $1',
      [userId]
    );

    let cart;
    if (cartResult.rows.length === 0) {
      const newCart = await pool.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING *',
        [userId]
      );
      cart = newCart.rows[0];
    } else {
      cart = cartResult.rows[0];
    }

    // Verificar se item já existe no carrinho
    const existingItem = await pool.query(
      'SELECT * FROM cart_items WHERE cart_id = $1 AND book_id = $2',
      [cart.id, bookId]
    );

    if (existingItem.rows.length > 0) {
      // Atualizar quantidade
      const newQuantity = existingItem.rows[0].quantity + quantity;
      if (book.stock < newQuantity) {
        return res.status(400).json({ error: 'Estoque insuficiente para a quantidade desejada' });
      }
      
      await pool.query(
        'UPDATE cart_items SET quantity = $1 WHERE id = $2',
        [newQuantity, existingItem.rows[0].id]
      );
    } else {
      // Adicionar novo item
      await pool.query(
        'INSERT INTO cart_items (cart_id, book_id, quantity) VALUES ($1, $2, $3)',
        [cart.id, bookId, quantity]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao adicionar item ao carrinho:', error);
    res.status(500).json({ error: 'Erro ao adicionar item ao carrinho' });
  }
});

app.put('/api/cart/items/:itemId', authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;

    if (quantity < 0) {
      return res.status(400).json({ error: 'Quantidade inválida' });
    }

    // Buscar item do carrinho
    const itemResult = await pool.query(
      `SELECT ci.*, b.stock 
       FROM cart_items ci 
       JOIN carts c ON ci.cart_id = c.id 
       JOIN books b ON ci.book_id = b.id 
       WHERE ci.id = $1 AND c.user_id = $2`,
      [itemId, userId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    const item = itemResult.rows[0];

    if (quantity === 0) {
      // Remover item
      await pool.query('DELETE FROM cart_items WHERE id = $1', [itemId]);
    } else {
      // Verificar estoque
      if (item.stock < quantity) {
        return res.status(400).json({ error: 'Estoque insuficiente' });
      }
      
      // Atualizar quantidade
      await pool.query(
        'UPDATE cart_items SET quantity = $1 WHERE id = $2',
        [quantity, itemId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar item do carrinho:', error);
    res.status(500).json({ error: 'Erro ao atualizar item do carrinho' });
  }
});

app.delete('/api/cart/items/:itemId', authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.id;

    // Verificar se o item pertence ao usuário
    const itemResult = await pool.query(
      `SELECT ci.* 
       FROM cart_items ci 
       JOIN carts c ON ci.cart_id = c.id 
       WHERE ci.id = $1 AND c.user_id = $2`,
      [itemId, userId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    await pool.query('DELETE FROM cart_items WHERE id = $1', [itemId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover item do carrinho:', error);
    res.status(500).json({ error: 'Erro ao remover item do carrinho' });
  }
});

app.delete('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar carrinho do usuário
    const cartResult = await pool.query(
      'SELECT * FROM carts WHERE user_id = $1',
      [userId]
    );

    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Carrinho não encontrado' });
    }

    const cart = cartResult.rows[0];

    // Limpar itens do carrinho
    await pool.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);

    // Resetar totais do carrinho
    await pool.query(
      'UPDATE carts SET subtotal = 0, shipping = 0, total = 0 WHERE id = $1',
      [cart.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao limpar carrinho:', error);
    res.status(500).json({ error: 'Erro ao limpar carrinho' });
  }
});

// Rotas de Pedidos
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar carrinho do usuário
    const cartResult = await pool.query(
      `SELECT c.*, ci.*, b.* 
       FROM carts c 
       JOIN cart_items ci ON c.id = ci.cart_id 
       JOIN books b ON ci.book_id = b.id 
       WHERE c.user_id = $1`,
      [userId]
    );

    if (cartResult.rows.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio' });
    }

    // Agrupar itens do carrinho
    const cartItems = cartResult.rows;
    const cart = {
      id: cartItems[0].cart_id,
      subtotal: parseFloat(cartItems[0].subtotal),
      shipping: parseFloat(cartItems[0].shipping),
      total: parseFloat(cartItems[0].total)
    };

    // Verificar estoque antes de finalizar
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        return res.status(400).json({ 
          error: `Estoque insuficiente para "${item.title}". Disponível: ${item.stock}, Solicitado: ${item.quantity}` 
        });
      }
    }

    // Criar pedido
    const orderNumber = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const orderResult = await pool.query(
      `INSERT INTO orders (user_id, order_number, total, subtotal, shipping, status) 
       VALUES ($1, $2, $3, $4, $5, 'completed') 
       RETURNING *`,
      [userId, orderNumber, cart.total, cart.subtotal, cart.shipping]
    );

    const order = orderResult.rows[0];

    // Criar itens do pedido e atualizar estoque
    for (const item of cartItems) {
      // Adicionar item ao pedido
      await pool.query(
        `INSERT INTO order_items (order_id, book_id, quantity, unit_price) 
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.book_id, item.quantity, item.price]
      );

      // Atualizar estoque
      await pool.query(
        'UPDATE books SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.book_id]
      );
    }

    // Limpar carrinho
    await pool.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await pool.query(
      'UPDATE carts SET subtotal = 0, shipping = 0, total = 0 WHERE id = $1',
      [cart.id]
    );

    res.json({
      success: true,
      orderId: orderNumber,
      cart: {
        id: cart.id,
        items: cartItems.map(item => ({
          id: item.id,
          book: {
            id: item.book_id,
            title: item.title,
            author: item.author,
            price: parseFloat(item.price),
            image_url: item.image_url,
            condition: item.condition,
            stock: item.stock - item.quantity // Novo estoque
          },
          quantity: item.quantity
        })),
        subtotal: cart.subtotal,
        shipping: cart.shipping,
        total: cart.total
      }
    });
  } catch (error) {
    console.error('Erro ao finalizar pedido:', error);
    res.status(500).json({ error: 'Erro ao finalizar pedido' });
  }
});

// Rotas Admin
app.get('/api/admin/books', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books ORDER BY title');
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Erro ao buscar livros admin:', error);
    res.status(500).json({ error: 'Erro ao buscar livros' });
  }
});

app.post('/api/admin/books', authenticateToken, async (req, res) => {
  try {
    const { 
      title, author, publisher, price, originalPrice, 
      condition, imageUrl, stock, isbn, description, category 
    } = req.body;
    
    const result = await pool.query(
      `INSERT INTO books (title, author, publisher, price, original_price, condition, image_url, stock, isbn, description, category) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [title, author, publisher, price, originalPrice, condition, imageUrl, stock, isbn, description, category]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar livro:', error);
    res.status(500).json({ error: 'Erro ao criar livro' });
  }
});

app.put('/api/admin/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, author, publisher, price, originalPrice, 
      condition, imageUrl, stock, isbn, description, category 
    } = req.body;
    
    const result = await pool.query(
      `UPDATE books SET 
        title = $1, author = $2, publisher = $3, price = $4, original_price = $5, 
        condition = $6, image_url = $7, stock = $8, isbn = $9, description = $10, category = $11,
        updated_at = NOW()
       WHERE id = $12 
       RETURNING *`,
      [title, author, publisher, price, originalPrice, condition, imageUrl, stock, isbn, description, category, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar livro:', error);
    res.status(500).json({ error: 'Erro ao atualizar livro' });
  }
});

app.delete('/api/admin/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM books WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar livro:', error);
    res.status(500).json({ error: 'Erro ao deletar livro' });
  }
});

// Middleware de tratamento de erro
app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Rota para rotas não encontradas
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📚 API disponível em: http://localhost:${PORT}/api`);
  console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Database: ${process.env.DATABASE_URL ? 'Configurado' : 'Não configurado'}`);
});