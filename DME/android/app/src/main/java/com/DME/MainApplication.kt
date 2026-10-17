package com.DME

import android.app.Application
import android.os.Build
import android.webkit.CookieManager
import com.arthenica.ffmpegkit.reactnative.FFmpegKitReactNativePackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Remove FFmpegKit on emulator (x86_64) - native .so files not available
          val isEmulator = Build.SUPPORTED_ABIS.any { it.contains("x86") }
          if (isEmulator) {
            removeAll { it is FFmpegKitReactNativePackage }
          }
          add(AudioRecorderPackage())
          add(SystemBarPackage())
          add(RichTextInputPackage())
          add(MusicServicePackage())
          add(NavBarPackage())   // ✅ new
          add(SpeechRecognitionPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Rave architecture: intercept all OkHttp requests (including ExoPlayer OkHttpDataSource media chunks)
    // and attach authorized YouTube headers matching the exact client identity (IOS, ANDROID, or MWEB)
    // to prevent Google Video CDN 403 Forbidden cutoffs.
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient {
        return OkHttpClientProvider.createClientBuilder()
          .addInterceptor { chain ->
            val request = chain.request()
            val host = request.url.host
            if (host.contains("googlevideo.com")) {
              val builder = request.newBuilder()
              val cParam = request.url.queryParameter("c")

              if ("IOS".equals(cParam, ignoreCase = true)) {
                builder
                  .removeHeader("Origin")
                  .removeHeader("Referer")
                  .removeHeader("Sec-Fetch-Mode")
                  .removeHeader("Sec-Fetch-Site")
                  .removeHeader("Sec-Fetch-Dest")
                  .removeHeader("TE")
                  .removeHeader("Cookie")
                  .header("User-Agent", "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)")
              } else if ("ANDROID".equals(cParam, ignoreCase = true)) {
                builder
                  .removeHeader("Origin")
                  .removeHeader("Referer")
                  .removeHeader("Sec-Fetch-Mode")
                  .removeHeader("Sec-Fetch-Site")
                  .removeHeader("Sec-Fetch-Dest")
                  .removeHeader("TE")
                  .removeHeader("Cookie")
                  .header("User-Agent", "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip")
              } else {
                // MWEB / Web formats (Rave architecture with PO-Token)
                builder
                  .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36")
                  .header("Referer", "https://www.youtube.com")
                  .header("Origin", "https://www.youtube.com")
                  .header("Sec-Fetch-Mode", "cors")
                  .header("Sec-Fetch-Site", "cross-site")
                  .header("Sec-Fetch-Dest", "empty")
                try {
                  val ytCookies = CookieManager.getInstance().getCookie("https://www.youtube.com")
                  if (!ytCookies.isNullOrEmpty()) {
                    builder.header("Cookie", ytCookies)
                    android.util.Log.d("YouTubeInterceptor", "🍪 Injected YouTube cookies (${ytCookies.length} bytes) into CDN request")
                  } else {
                    builder.removeHeader("Cookie")
                  }
                } catch (e: Throwable) {
                  builder.removeHeader("Cookie")
                }
              }

              val finalReq = builder.build()
              val response = chain.proceed(finalReq)
              android.util.Log.i("YouTubeInterceptor", "HTTP ${response.code} (itag=${finalReq.url.queryParameter("itag")}, c=${cParam})")
              if (response.code == 403) {
                android.util.Log.e("YouTubeInterceptor", "🚨 HTTP 403 on ${finalReq.url}")
              }
              response
            } else {
              chain.proceed(request)
            }
          }
          .build()
      }
    })
    loadReactNative(this)
  }
}