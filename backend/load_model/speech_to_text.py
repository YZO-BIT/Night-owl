import speech_recognition as sr

try:
    r = sr.Recognizer()
except Exception as e:
    print(e)
print("Listening...")
