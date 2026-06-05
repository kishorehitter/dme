@echo off
TITLE React Native Nuclear Reset
echo ==========================================
echo   REACT NATIVE INDUSTRIAL CLEAN START
echo ==========================================

echo [1/5] Killing zombie Node and Java processes...
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM java.exe /T 2>nul

echo [2/5] Cleaning Android Gradle cache...
cd android
call gradlew clean
cd ..

echo [3/5] Clearing Metro Bundler cache...
:: We start this in a new window so it doesn't block the script
start cmd /k "npx react-native start --reset-cache"

echo [4/5] Waiting for Metro to initialize (5s)...
timeout /t 5 /nobreak >nul

echo [5/5] Launching Android App...
npx react-native run-android

echo ==========================================
echo   RESET COMPLETE - Monitor Metro Window
echo ==========================================
pause
