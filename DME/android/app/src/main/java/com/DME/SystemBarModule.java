package com.DME;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.facebook.react.bridge.UiThreadUtil;

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

    @ReactMethod
    public void setNavigationBarColor(final String colorHex, final boolean lightIcons) {
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

    private void applyNavigationBarColor(final String colorHex, final boolean lightIcons) {
        final Activity activity = getCurrentActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }

        UiThreadUtil.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Window window = activity.getWindow();
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                try {
                    if ("#00000000".equals(colorHex) || "#01000000".equals(colorHex) || "transparent".equalsIgnoreCase(colorHex)) {
                        window.setNavigationBarColor(Color.TRANSPARENT);
                    } else {
                        window.setNavigationBarColor(Color.parseColor(colorHex));
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        window.setNavigationBarContrastEnforced(false);
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

    // --- LifecycleEventListener ---

    @Override
    public void onHostResume() {
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
    }

    @Override
    public void onHostPause() {
        // no-op
    }

    @Override
    public void onHostDestroy() {
        // no-op
    }
}