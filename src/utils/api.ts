// Configuração da API
const getApiBaseUrl = () => {
  // Para desenvolvimento local
  return 'http://localhost:3001/api';
};

const API_BASE_URL = getApiBaseUrl();

console.log('🌐 API Base URL:', API_BASE_URL);

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

class ApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    console.log('🔗 Fazendo requisição para:', url);

    try {
      const response = await fetch(url, config);
      
      console.log('📡 Resposta recebida:', response.status, response.statusText);
      
      if (!response.ok) {
        // Se for 404 em /books/featured, retorna array vazio
        if (endpoint === '/books/featured' && response.status === 404) {
          console.log('⚠️ Rota /featured não encontrada, usando fallback');
          return [] as T;
        }
        
        const errorData = await response.json().catch(() => null);
        console.error('❌ Erro na resposta:', errorData);
        throw new Error(errorData?.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Dados recebidos:', data);
      return data;
    } catch (error) {
      console.error('💥 Erro na requisição:', error);
      
      // Se for erro de CORS ou rede, retorna dados mock
      if (error instanceof TypeError) {
        console.warn('🌐 Erro de rede/CORS, usando dados mock...');
        return this.getMockData(endpoint) as T;
      }
      
      throw error;
    }
  }

  // Dados mock para desenvolvimento quando a API não está disponível
  private getMockData(endpoint: string) {
    console.log('🔄 Usando dados mock para:', endpoint);
    
    const mockBooks = [
      {
        id: "1",
        title: "O Senhor dos Anéis: A Sociedade do Anel",
        author: "J.R.R. Tolkien",
        publisher: "Martins Fontes",
        price: 45.90,
        originalPrice: 89.90,
        condition: "Ótimo Estado",
        imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400",
        stock: 10,
        isbn: "978-8533613379",
        description: "A jornada épica pela Terra-média começa neste primeiro volume da trilogia.",
        category: "Fantasia"
      },
      {
        id: "2",
        title: "1984",
        author: "George Orwell",
        publisher: "Companhia das Letras",
        price: 35.90,
        originalPrice: 59.90,
        condition: "Bom Estado",
        imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400",
        stock: 8,
        isbn: "978-8535914849",
        description: "Um clássico distópico sobre vigilância e controle totalitário.",
        category: "Ficção Científica"
      },
      {
        id: "3",
        title: "Cem Anos de Solidão",
        author: "Gabriel García Márquez",
        publisher: "Record",
        price: 42.90,
        originalPrice: 79.90,
        condition: "Ótimo Estado",
        imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400",
        stock: 5,
        isbn: "978-8501014474",
        description: "A obra-prima do realismo mágico que conta a história da família Buendía.",
        category: "Literatura Clássica"
      }
    ];

    switch (endpoint) {
      case '/books':
      case '/books/featured':
        return mockBooks;
      
      case '/books?page=1&limit=12':
        return {
          items: mockBooks,
          total: mockBooks.length,
          page: 1,
          limit: 12,
          totalPages: 1
        };
      
      case '/cart':
        return {
          id: "mock-cart-1",
          items: [],
          subtotal: 0,
          shipping: 0,
          total: 0
        };
      
      default:
        return null;
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }

  // Método para requests autenticados
  async authenticatedRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('auth_token');
    
    const authHeaders = token 
      ? { Authorization: `Bearer ${token}` }
      : {};

    return this.request<T>(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        ...authHeaders,
      },
    });
  }
}

export const api = new ApiClient();