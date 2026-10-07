package com.DME

import android.app.Application
import android.os.Build
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
            if (host.contains("googlevideo.com") || host.contains("youtube.com")) {
              val cParam = request.url.queryParameter("c")
              val builder = request.newBuilder()
              if ("IOS".equals(cParam, ignoreCase = true)) {
                builder
                  .removeHeader("Origin")
                  .removeHeader("Referer")
                  .removeHeader("Sec-Fetch-Mode")
                  .removeHeader("Sec-Fetch-Site")
                  .removeHeader("Sec-Fetch-Dest")
                  .header("User-Agent", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)")
              } else if ("ANDROID".equals(cParam, ignoreCase = true)) {
                builder
                  .removeHeader("Origin")
                  .removeHeader("Referer")
                  .removeHeader("Sec-Fetch-Mode")
                  .removeHeader("Sec-Fetch-Site")
                  .removeHeader("Sec-Fetch-Dest")
                  .header("User-Agent", "com.google.android.youtube/19.29.37 (Linux; U; Android 11) gzip")
              } else {
                builder
                  .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
                  .header("Referer", "https://m.youtube.com/")
                  .header("Origin", "https://m.youtube.com")
                  .header("Sec-Fetch-Mode", "cors")
                  .header("Sec-Fetch-Site", "cross-site")
                  .header("Sec-Fetch-Dest", "empty")
              }
              val finalReq = builder.build()
              android.util.Log.d("YouTubeInterceptor", "Intercepted ${host} (c=${cParam}) -> UA: ${finalReq.header("User-Agent")}")
              chain.proceed(finalReq)
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