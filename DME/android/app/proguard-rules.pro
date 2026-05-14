# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# React Native Google Signin
-keep class com.reactnativegooglesignin.** { *; }

# Keep specific members that might be accessed via reflection
-keepclassmembers class * {
  @com.google.android.gms.common.annotation.KeepName *;
}
-keepnames class * {
  @com.google.android.gms.common.annotation.KeepName *;
}
-keepclassmembernames class * {
  @com.google.android.gms.common.annotation.KeepName *;
}

# React Native (General)
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.modules.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.views.** { *; }

# Fresco (React Native Image Loader)
-keep class com.facebook.drawee.** { *; }
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.imageutils.** { *; }
-keep class com.facebook.binaryresource.** { *; }
-keep class com.facebook.cache.** { *; }
-keep class com.facebook.common.** { *; }
-keep class com.facebook.imageformat.** { *; }

# OkHttp (Networking)
-keepattributes Signature
-keepattributes *Annotation*
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-dontwarn okhttp3.**

# Axios / Okio
-keep class okio.** { *; }
-dontwarn okio.**

# React Native Video
-keep class com.brentvatne.react.** { *; }
-keep class com.google.android.exoplayer2.** { *; }
-dontwarn com.brentvatne.react.**

# ffmpeg-kit
-keep class com.arthenica.ffmpegkit.** { *; }

# LiveKit & WebRTC
-keep class org.webrtc.** { *; }
-keep class com.livekit.reactnative.** { *; }
-keep class com.oney.WebRTCModule.** { *; }

# React Native Sound Player
-keep class com.johnsonsu.rnsoundplayer.** { *; }

# RN Fetch Blob
-keep class com.RNFetchBlob.** { *; }

# React Native SVG
-keep class com.horcrux.svg.** { *; }

# Vector Icons
-keep class com.oblador.vectoricons.** { *; }

# Keep models/serializers if you have any custom Java models
# -keep class com.DME.models.** { *; }

# General safety
-keepattributes EnclosingMethod
-dontwarn javax.annotation.**
-dontwarn javax.inject.**
-dontwarn sun.misc.Unsafe
