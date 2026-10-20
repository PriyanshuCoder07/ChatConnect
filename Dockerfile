FROM maven:3.10.0-eclipse-temurin-25 AS build
WORKDIR /workspace
COPY backend/pom.xml ./pom.xml
COPY backend/src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /workspace/target/chatconnect-backend-0.1.0-SNAPSHOT.jar /app/chatconnect.jar
ENV PORT=10000
EXPOSE 10000
ENTRYPOINT ["sh", "-c", "java -jar /app/chatconnect.jar --server.port=${PORT:-10000}"]
