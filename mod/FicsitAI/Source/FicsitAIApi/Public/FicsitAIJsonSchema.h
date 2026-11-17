#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Templates/ValueOrError.h"
#include "FicsitAIApiTypes.h"

/**
 * Validator v0 (ARCHITECTURE §3.2, §7.1, ADR-018; V-3): проверка аргументов операции по её JSON Schema.
 *
 * Подмножество JSON Schema 2020-12, которого хватает схемам аргументов из docs/contracts/schemas/:
 * type (object, string, integer, number, boolean, null), properties, required, additionalProperties (true/false),
 * enum, minLength/maxLength (в символах Юникода), minimum/maximum, dependentRequired.
 * Аннотации ($schema, $id, title, description, default, examples, $comment) проверку не меняют.
 *
 * Незнакомое ключевое слово — отказ при компиляции, а не молчаливый пропуск: иначе схема, которую CI проверяет
 * через ajv --strict, в моде проверялась бы слабее, и модель прошла бы туда, куда не пускает контракт.
 */
class FICSITAIAPI_API FFicsitAIJsonSchema
{
public:
    /** Скомпилировать схему. Ошибка — текст с путём ключевого слова. */
    static TValueOrError<FFicsitAIJsonSchema, FString> Compile(const TSharedRef<FJsonObject>& Schema);
    /** То же из текста JSON. */
    static TValueOrError<FFicsitAIJsonSchema, FString> Compile(const FString& SchemaText);

    /** Проверить значение. Нарушение — INVALID_ARGUMENT с путём поля и причиной, первое найденное. */
    TOptional<FFicsitAIApiError> Validate(const TSharedRef<FJsonValue>& Value) const;
    TOptional<FFicsitAIApiError> Validate(const TSharedRef<FJsonObject>& Object) const;

    /** Исходная схема — как её видит модель в описании инструмента. */
    TSharedRef<FJsonObject> GetSource() const { return Source.ToSharedRef(); }

private:
    struct FNode;

    TSharedPtr<FNode> Root;
    TSharedPtr<FJsonObject> Source;
};
