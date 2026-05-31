import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor wraps the built web app (the `dist` folder) into native
// iOS/Android shells. It stays dormant until you run:
//   npm run build && npm run cap:add:ios   (or cap:add:android)
//   npm run cap:sync
const config: CapacitorConfig = {
  appId: 'com.example.testgitclaudeproject',
  appName: 'Test Git Claude Project',
  webDir: 'dist',
}

export default config
