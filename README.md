# Panel de Cargas de Trabajo

Dashboard interactivo para gestionar cargas de trabajo del equipo. Glassmorphism dark mode con animaciones, responsive, y listo para integrar Basecamp.

## Deploy en Vercel (gratis, 2 minutos)

### Paso 1: Sube el proyecto a GitHub
1. Crea un repo nuevo en [github.com/new](https://github.com/new)
2. En tu terminal:
```bash
cd team-workload-dashboard
git init
git add .
git commit -m "Dashboard v2.0"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

### Paso 2: Conecta con Vercel
1. Ve a [vercel.com](https://vercel.com) e inicia sesión con GitHub
2. Click en **"Add New Project"**
3. Selecciona tu repo
4. Vercel detecta Vite automáticamente — no toques nada
5. Click en **"Deploy"**
6. En ~60 segundos tendrás tu URL pública (ej: `tu-proyecto.vercel.app`)

### Cada vez que hagas push a main, Vercel re-deploya automáticamente.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`

## Stack
- React 18 + Vite 5
- Recharts (gráficos)
- Lucide React (iconos)
- CSS puro (sin Tailwind)

## Estructura
```
src/
  App.jsx      → Dashboard completo (vistas, kanban, gantt, filtros)
  index.css    → Glassmorphism tokens, animaciones, responsive
  main.jsx     → Entry point
```
