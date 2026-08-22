package com.DME;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class SystemBarModule extends ReactContextBaseJavaModule implements LifecycleEventListener {

    public SystemBarModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addLifecycleEventListener(this);
    }

    @Override
    public String getName() {
        return "SystemBar";
    }

    private volatile String lastNavColor = null;
    private volatile boolean lastNavLightIcons = false;

    private volatile String lastStatusColor = null;
    private volatile boolean lastStatusLightIcons = false;
    private volatile String lastWindowBackground = null;

    @ReactMethod
    public void setNavigationBarColor(final String colorHex, final boolean lightIcons) {
        android.util.Log.d("SystemBarNav", "setNavigationBarColor called: color=" + colorHex + ", lightIcons=" + lightIcons);
        lastNavColor = colorHex;
        lastNavLightIcons = lightIcons;
        applyNavigationBarColor(colorHex, lightIcons);
    }

    @ReactMethod
    public void setStatusBarColor(final String colorHex, final boolean lightIcons) {
        lastStatusColor = colorHex;
        lastStatusLightIcons = lightIcons;
        applyStatusBarColor(colorHex, lightIcons);
    }

    @ReactMethod
    public void setFitsSystemWindows(final boolean fits) {
        final Activity activity = getCurrentActivity();
        if (activity == null) return;
        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                // Permanently lock decor fits system windows to false (edge-to-edge)
                WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
            }
        });
    }

    /**
     * Sets the native window background color — this is what shows through the
     * transparent navigation bar when no React Native view paints that area.
     * Call with '#0D0D0D' when entering Music Room, restore to '#020912' on exit.
     */
    @ReactMethod
    public void setWindowBackground(final String colorHex) {
        lastWindowBackground = colorHex;
        final Activity activity = getCurrentActivity();
        if (activity == null) return;
        android.util.Log.d("SystemBarNav", "setWindowBackground called: color=" + colorHex);
        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    int color;
                    if ("#00000000".equals(colorHex) || "transparent".equalsIgnoreCase(colorHex)) {
                        color = Color.TRANSPARENT;
                    } else {
                        color = Color.parseColor(colorHex);
                    }
                    activity.getWindow().getDecorView().setBackgroundColor(color);
                } catch (Exception e) {
                    // ignore invalid color
                }
            }
        });
    }

    private String currentNavColor = null;
    private Boolean currentNavLightIcons = null;

    private String currentStatusColor = null;
    private Boolean currentStatusLightIcons = null;

    private String currentWindowBg = null;

    private void applyNavigationBarColor(final String colorHex, final boolean lightIcons) {
        final Activity activity = getCurrentActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }
        if (colorHex != null && colorHex.equals(currentNavColor) && currentNavLightIcons != null && currentNavLightIcons == lightIcons) {
            return;
        }
        currentNavColor = colorHex;
        currentNavLightIcons = lightIcons;

        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Window window = activity.getWindow();
                WindowCompat.setDecorFitsSystemWindows(window, false);
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                try {
                    if ("#00000000".equals(colorHex) || "#01000000".equals(colorHex) || "transparent".equalsIgnoreCase(colorHex)) {
                        window.setNavigationBarColor(Color.TRANSPARENT);
                    } else {
                        window.setNavigationBarColor(Color.parseColor(colorHex));
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        window.setNavigationBarContrastEnforced(false);
                        window.setStatusBarContrastEnforced(false);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        window.setNavigationBarDividerColor(Color.TRANSPARENT);
                    }
                } catch (Exception e) {
                    // Ignore invalid colors
                }

                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                if (controller != null) {
                    controller.setAppearanceLightNavigationBars(!lightIcons);
                }
            }
        });
    }

    private void applyStatusBarColor(final String colorHex, final boolean lightIcons) {
        final Activity activity = getCurrentActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }
        if (colorHex != null && colorHex.equals(currentStatusColor) && currentStatusLightIcons != null && currentStatusLightIcons == lightIcons) {
            return;
        }
        currentStatusColor = colorHex;
        currentStatusLightIcons = lightIcons;

        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Window window = activity.getWindow();
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                try {
                    if ("#00000000".equals(colorHex) || "#01000000".equals(colorHex) || "transparent".equalsIgnoreCase(colorHex)) {
                        window.setStatusBarColor(Color.TRANSPARENT);
                    } else {
                        window.setStatusBarColor(Color.parseColor(colorHex));
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        window.setStatusBarContrastEnforced(false);
                    }
                } catch (Exception e) {
                    // Ignore invalid colors
                }

                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                if (controller != null) {
                    controller.setAppearanceLightStatusBars(!lightIcons);
                }
            }
        });
    }

    private ViewTreeObserver.OnGlobalLayoutListener layoutListener = null;

    @ReactMethod
    public void startKeyboardHeightObserver() {
        final Activity activity = getCurrentActivity();
        if (activity == null) return;
        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final View contentView = activity.findViewById(android.R.id.content);
                    if (contentView == null) return;
                    if (layoutListener != null) {
                        contentView.getViewTreeObserver().removeOnGlobalLayoutListener(layoutListener);
                    }
                    layoutListener = new ViewTreeObserver.OnGlobalLayoutListener() {
                        private int lastReportedHeight = -1;

                        @Override
                        public void onGlobalLayout() {
                            Rect r = new Rect();
                            contentView.getWindowVisibleDisplayFrame(r);
                            int screenHeight = contentView.getRootView().getHeight();
                            int keypadHeight = screenHeight - r.bottom;
                            float density = activity.getResources().getDisplayMetrics().density;
                            int keypadHeightDp = (int) (keypadHeight / density);

                            if (Math.abs(keypadHeightDp - lastReportedHeight) >= 4) {
                                lastReportedHeight = keypadHeightDp;
                                WritableMap params = Arguments.createMap();
                                params.putDouble("height", keypadHeightDp > 60 ? keypadHeightDp : 0);
                                params.putBoolean("isVisible", keypadHeightDp > 60);

                                try {
                                    if (getReactApplicationContext().hasActiveReactInstance()) {
                                        getReactApplicationContext()
                                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                            .emit("onDynamicKeyboardHeight", params);
                                    }
                                } catch (Exception e) {
                                    // ignore
                                }
                            }
                        }
                    };
                    contentView.getViewTreeObserver().addOnGlobalLayoutListener(layoutListener);
                } catch (Exception e) {
                    android.util.Log.e("SystemBarNav", "Error in startKeyboardHeightObserver", e);
                }
            }
        });
    }

    // --- LifecycleEventListener ---

    @Override
    public void onHostResume() {
        android.util.Log.d("SystemBarNav", "onHostResume: lastNavColor=" + lastNavColor + ", lastStatusColor=" + lastStatusColor);
        final Activity activity = getCurrentActivity();
        if (activity != null) {
            UiThreadUtil.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
                    if (lastStatusColor == null || "#00000000".equals(lastStatusColor) || "transparent".equalsIgnoreCase(lastStatusColor)) {
                        activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        activity.getWindow().setNavigationBarContrastEnforced(false);
                        activity.getWindow().setStatusBarContrastEnforced(false);
                    }
                }
            });
        }
        if (lastNavColor != null) {
            applyNavigationBarColor(lastNavColor, lastNavLightIcons);
        }
        if (lastStatusColor != null) {
            applyStatusBarColor(lastStatusColor, lastStatusLightIcons);
        }
        if (lastWindowBackground != null) {
            setWindowBackground(lastWindowBackground);
        }
    }

    @Override
    public void onHostPause() {
        // no-op
    }

    @Override
    public void onHostDestroy() {
        try {
            final Activity activity = getCurrentActivity();
            if (activity != null && layoutListener != null) {
                final View contentView = activity.findViewById(android.R.id.content);
                if (contentView != null) {
                    contentView.getViewTreeObserver().removeOnGlobalLayoutListener(layoutListener);
                }
            }
        } catch (Exception e) {
            // ignore
        }
    }
}