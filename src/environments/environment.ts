export const environment = {
  production: false,
  // Utilise le proxy Angular → pas de CORS en développement
  // Le proxy redirige /api/* vers http://localhost/directcash/backend/*
  apiUrl: 'http://localhost/directcash/backend'
};
