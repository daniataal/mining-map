@rem Meridian Trade OS — Gradle Wrapper (Windows)
@rem Generate the wrapper jar once: gradle wrapper --gradle-version=8.7
@echo off
setlocal

set APP_HOME=%~dp0

if not exist "%APP_HOME%gradle\wrapper\gradle-wrapper.jar" (
    echo ERROR: gradle-wrapper.jar not found.
    echo Run: gradle wrapper --gradle-version=8.7 --distribution-type=bin
    exit /b 1
)

if defined JAVA_HOME (
    set JAVACMD=%JAVA_HOME%\bin\java.exe
) else (
    set JAVACMD=java.exe
)

"%JAVACMD%" %JAVA_OPTS% %GRADLE_OPTS% ^
    -classpath "%APP_HOME%gradle\wrapper\gradle-wrapper.jar" ^
    org.gradle.wrapper.GradleWrapperMain %*
