const fs = require('fs');

const path = 'C:/Dev/AndroidApp/DME/src/screens/chat/ChatRoomScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace THEME_COLOR with theme.primary everywhere
content = content.replace(/THEME_COLOR/g, 'theme.primary');

// Delete const theme.primary = theme.primary;
content = content.replace(/const theme\.primary = theme\.primary;/g, '');
content = content.replace(/const theme\.primary = ['"]#4597f5f6['"];/g, '');

// Also I should check if there are other inline colors.
// backgroundColor: '#FFFFFF' or '#fff' on containers -> theme.background
content = content.replace(/backgroundColor:\s*['"]#FFFFFF['"]/gi, 'backgroundColor: theme.background');
content = content.replace(/backgroundColor:\s*['"]#fff['"]/gi, 'backgroundColor: theme.background');
content = content.replace(/backgroundColor:\s*['"]#F5F5F5['"]/gi, 'backgroundColor: theme.chatBackground');
content = content.replace(/backgroundColor:\s*['"]#f5f5f5['"]/gi, 'backgroundColor: theme.chatBackground');
content = content.replace(/backgroundColor:\s*['"]#E8E8E8['"]/gi, 'backgroundColor: theme.chatBackground');
content = content.replace(/color:\s*['"]#000['"]/gi, 'color: theme.textPrimary');
content = content.replace(/color:\s*['"]#333['"]/gi, 'color: theme.textPrimary');
content = content.replace(/color:\s*['"]#111b21['"]/gi, 'color: theme.textPrimary');
content = content.replace(/color:\s*['"]#666['"]/gi, 'color: theme.textSecondary');
content = content.replace(/color:\s*['"]#667781['"]/gi, 'color: theme.textSecondary');
content = content.replace(/color:\s*['"]#999['"]/gi, 'color: theme.textMuted');
content = content.replace(/color:\s*['"]#888['"]/gi, 'color: theme.textMuted');
content = content.replace(/color:\s*['"]#8696a0['"]/gi, 'color: theme.textMuted');
content = content.replace(/borderColor:\s*['"]#f0f0f0['"]/gi, 'borderColor: theme.border');
content = content.replace(/borderColor:\s*['"]#E9EDEF['"]/gi, 'borderColor: theme.border');

// Replace shadowColor: '#000' because I might have replaced it above incorrectly
// Actually, earlier I did content.replace(/color:\s*['"]#000['"]/gi, 'color: theme.textPrimary'); which only matches 'color: '.
// I didn't replace shadowColor.

// Let's also check if 'theme.primary' is valid JS, it is since it's an object property.

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed THEME_COLOR');
