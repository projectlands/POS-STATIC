<?php
/**
 * REST API Bridge for POS Static <-> MySQL / MariaDB
 * Letakkan file ini di web server PHP Anda (XAMPP / cPanel / VPS)
 * Contoh URL Endpoint: http://localhost/pos-api/api.php
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ====================================================
// KONFIGURASI DATABASE MYSQL / MARIADB
// ====================================================
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'pos_database');
define('API_SECRET_KEY', 'pos12345'); // Ganti dengan secret key yang Anda inginkan

// ====================================================
// VERIFIKASI KEAMANAN API KEY
// ====================================================
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true) ?? [];

$providedKey = $_GET['key'] ?? $input['key'] ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$providedKey = str_replace('Bearer ', '', $providedKey);

if ($providedKey !== API_SECRET_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Akses ditolak: API Secret Key salah atau tidak ada.']);
    exit();
}

// ====================================================
// KONEKSI DATABASE & INISIALISASI TABEL OTOMATIS
// ====================================================
try {
    $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    // Coba buat database otomatis jika belum ada
    try {
        $rootPdo = new PDO('mysql:host=' . DB_HOST . ';charset=utf8mb4', DB_USER, DB_PASS);
        $rootPdo->exec("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);
    } catch (Exception $ex) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Gagal koneksi database MySQL: ' . $e->getMessage()]);
        exit();
    }
}

// Buat tabel jika belum ada
$pdo->exec("
    CREATE TABLE IF NOT EXISTS `products` (
        `id` BIGINT PRIMARY KEY,
        `code` VARCHAR(100),
        `name` VARCHAR(255) NOT NULL,
        `category` VARCHAR(100),
        `price` DOUBLE NOT NULL DEFAULT 0,
        `cost` DOUBLE NOT NULL DEFAULT 0,
        `stock` INT NOT NULL DEFAULT 0,
        `isSempol` TINYINT(1) DEFAULT 0,
        `piecesPerUnit` INT DEFAULT 1,
        `unitCost` DOUBLE DEFAULT 0,
        `color` VARCHAR(50),
        `icon` VARCHAR(50),
        `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS `categories` (
        `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
        `name` VARCHAR(100) NOT NULL UNIQUE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS `transactions` (
        `id` VARCHAR(100) PRIMARY KEY,
        `timestamp` BIGINT NOT NULL,
        `items_json` LONGTEXT NOT NULL,
        `subtotal` DOUBLE NOT NULL,
        `discount` DOUBLE NOT NULL DEFAULT 0,
        `taxSvc` DOUBLE NOT NULL DEFAULT 0,
        `total` DOUBLE NOT NULL,
        `paymentMethod` VARCHAR(50),
        `amountPaid` DOUBLE,
        `change` DOUBLE,
        `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS `expenses` (
        `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
        `timestamp` BIGINT NOT NULL,
        `date` VARCHAR(20),
        `type` VARCHAR(50) NOT NULL,
        `title` VARCHAR(255) NOT NULL,
        `amount` DOUBLE NOT NULL,
        `note` TEXT,
        `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS `store_settings` (
        `setting_key` VARCHAR(100) PRIMARY KEY,
        `setting_value` LONGTEXT NOT NULL
    ) ENGINE=InnoDB;
");

// ====================================================
// ROUTING API ACTIONS
// ====================================================
$action = $_GET['action'] ?? $input['action'] ?? '';

switch ($action) {
    case 'ping':
        echo json_encode([
            'success' => true,
            'message' => 'Koneksi MySQL / MariaDB Sukses!',
            'db_name' => DB_NAME,
            'server_time' => date('Y-m-d H:i:s')
        ]);
        break;

    case 'save_transaction':
        $t = $input['data'] ?? null;
        if (!$t || !isset($t['id'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Data transaksi tidak valid']);
            break;
        }
        $stmt = $pdo->prepare("
            INSERT INTO `transactions` (`id`, `timestamp`, `items_json`, `subtotal`, `discount`, `taxSvc`, `total`, `paymentMethod`, `amountPaid`, `change`)
            VALUES (:id, :ts, :items, :subtotal, :disc, :tax, :total, :method, :paid, :change)
            ON DUPLICATE KEY UPDATE `total` = VALUES(`total`), `paymentMethod` = VALUES(`paymentMethod`)
        ");
        $stmt->execute([
            ':id' => $t['id'],
            ':ts' => $t['timestamp'],
            ':items' => json_encode($t['items']),
            ':subtotal' => $t['subtotal'],
            ':disc' => $t['discount'] ?? 0,
            ':tax' => $t['taxSvc'] ?? 0,
            ':total' => $t['total'],
            ':method' => $t['paymentMethod'] ?? 'Cash',
            ':paid' => $t['amountPaid'] ?? $t['total'],
            ':change' => $t['change'] ?? 0
        ]);
        echo json_encode(['success' => true, 'message' => 'Transaksi berhasil dicatat ke MySQL!']);
        break;

    case 'save_product':
        $p = $input['data'] ?? null;
        if (!$p) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Data produk tidak valid']);
            break;
        }
        $stmt = $pdo->prepare("
            INSERT INTO `products` (`id`, `code`, `name`, `category`, `price`, `cost`, `stock`, `isSempol`, `piecesPerUnit`, `unitCost`, `color`, `icon`)
            VALUES (:id, :code, :name, :cat, :price, :cost, :stock, :isSempol, :pieces, :unitCost, :color, :icon)
            ON DUPLICATE KEY UPDATE
                `code` = VALUES(`code`),
                `name` = VALUES(`name`),
                `category` = VALUES(`category`),
                `price` = VALUES(`price`),
                `cost` = VALUES(`cost`),
                `stock` = VALUES(`stock`),
                `isSempol` = VALUES(`isSempol`),
                `piecesPerUnit` = VALUES(`piecesPerUnit`),
                `unitCost` = VALUES(`unitCost`)
        ");
        $stmt->execute([
            ':id' => $p['id'],
            ':code' => $p['code'] ?? '',
            ':name' => $p['name'],
            ':cat' => $p['category'] ?? 'Umum',
            ':price' => $p['price'] ?? 0,
            ':cost' => $p['cost'] ?? 0,
            ':stock' => $p['stock'] ?? 0,
            ':isSempol' => !empty($p['isSempol']) ? 1 : 0,
            ':pieces' => $p['piecesPerUnit'] ?? 1,
            ':unitCost' => $p['unitCost'] ?? 0,
            ':color' => $p['color'] ?? 'indigo',
            ':icon' => $p['icon'] ?? 'fa-tag'
        ]);
        echo json_encode(['success' => true, 'message' => 'Produk berhasil disimpan ke MySQL!']);
        break;

    case 'delete_product':
        $delId = $input['id'] ?? $_GET['id'] ?? null;
        if ($delId) {
            $stmt = $pdo->prepare("DELETE FROM `products` WHERE `id` = :id");
            $stmt->execute([':id' => $delId]);
            echo json_encode(['success' => true, 'message' => 'Produk berhasil dihapus dari MySQL!']);
        } else {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'ID produk tidak valid']);
        }
        break;

    case 'delete_transaction':
        $delTxId = $input['id'] ?? $_GET['id'] ?? null;
        if ($delTxId) {
            $stmt = $pdo->prepare("DELETE FROM `transactions` WHERE `id` = :id");
            $stmt->execute([':id' => $delTxId]);
            echo json_encode(['success' => true, 'message' => 'Transaksi berhasil dihapus dari MySQL!']);
        } else {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'ID transaksi tidak valid']);
        }
        break;

    case 'save_expense':
        $e = $input['data'] ?? null;
        if (!$e) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Data pengeluaran tidak valid']);
            break;
        }
        $stmt = $pdo->prepare("
            INSERT INTO `expenses` (`timestamp`, `date`, `type`, `title`, `amount`, `note`)
            VALUES (:ts, :dt, :tp, :ttl, :amt, :note)
        ");
        $stmt->execute([
            ':ts' => $e['timestamp'] ?? time() * 1000,
            ':dt' => $e['date'] ?? date('Y-m-d'),
            ':tp' => $e['type'] ?? 'operational',
            ':ttl' => $e['title'] ?? 'Pengeluaran',
            ':amt' => $e['amount'] ?? 0,
            ':note' => $e['note'] ?? ''
        ]);
        echo json_encode(['success' => true, 'message' => 'Pengeluaran berhasil disimpan ke MySQL!']);
        break;

    case 'bulk_upload':
        $data = $input['data'] ?? null;
        if (!$data) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Data bulk upload kosong']);
            break;
        }

        $pdo->beginTransaction();
        try {
            // Upload products
            if (!empty($data['products'])) {
                $pStmt = $pdo->prepare("
                    INSERT INTO `products` (`id`, `code`, `name`, `category`, `price`, `cost`, `stock`, `isSempol`, `piecesPerUnit`, `unitCost`, `color`, `icon`)
                    VALUES (:id, :code, :name, :cat, :price, :cost, :stock, :isSempol, :pieces, :unitCost, :color, :icon)
                    ON DUPLICATE KEY UPDATE `price` = VALUES(`price`), `stock` = VALUES(`stock`), `cost` = VALUES(`cost`)
                ");
                foreach ($data['products'] as $prod) {
                    $pStmt->execute([
                        ':id' => $prod['id'],
                        ':code' => $prod['code'] ?? '',
                        ':name' => $prod['name'],
                        ':cat' => $prod['category'] ?? 'Umum',
                        ':price' => $prod['price'] ?? 0,
                        ':cost' => $prod['cost'] ?? 0,
                        ':stock' => $prod['stock'] ?? 0,
                        ':isSempol' => !empty($prod['isSempol']) ? 1 : 0,
                        ':pieces' => $prod['piecesPerUnit'] ?? 1,
                        ':unitCost' => $prod['unitCost'] ?? 0,
                        ':color' => $prod['color'] ?? 'indigo',
                        ':icon' => $prod['icon'] ?? 'fa-tag'
                    ]);
                }
            }

            // Upload transactions
            if (!empty($data['transactions'])) {
                $tStmt = $pdo->prepare("
                    INSERT INTO `transactions` (`id`, `timestamp`, `items_json`, `subtotal`, `discount`, `taxSvc`, `total`, `paymentMethod`, `amountPaid`, `change`)
                    VALUES (:id, :ts, :items, :subtotal, :disc, :tax, :total, :method, :paid, :change)
                    ON DUPLICATE KEY UPDATE `total` = VALUES(`total`)
                ");
                foreach ($data['transactions'] as $tx) {
                    $tStmt->execute([
                        ':id' => $tx['id'],
                        ':ts' => $tx['timestamp'],
                        ':items' => json_encode($tx['items'] ?? []),
                        ':subtotal' => $tx['subtotal'] ?? 0,
                        ':disc' => $tx['discount'] ?? 0,
                        ':tax' => $tx['taxSvc'] ?? 0,
                        ':total' => $tx['total'] ?? 0,
                        ':method' => $tx['paymentMethod'] ?? 'Cash',
                        ':paid' => $tx['amountPaid'] ?? 0,
                        ':change' => $tx['change'] ?? 0
                    ]);
                }
            }

            // Upload expenses
            if (!empty($data['expenses'])) {
                $eStmt = $pdo->prepare("
                    INSERT INTO `expenses` (`id`, `timestamp`, `date`, `type`, `title`, `amount`, `note`)
                    VALUES (:id, :ts, :dt, :tp, :ttl, :amt, :note)
                    ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`)
                ");
                foreach ($data['expenses'] as $exp) {
                    $eStmt->execute([
                        ':id' => $exp['id'] ?? null,
                        ':ts' => $exp['timestamp'] ?? time() * 1000,
                        ':dt' => $exp['date'] ?? date('Y-m-d'),
                        ':tp' => $exp['type'] ?? 'operational',
                        ':ttl' => $exp['title'] ?? 'Biaya',
                        ':amt' => $exp['amount'] ?? 0,
                        ':note' => $exp['note'] ?? ''
                    ]);
                }
            }

            $pdo->commit();
            echo json_encode([
                'success' => true,
                'message' => 'Bulk Upload ke MySQL Berhasil!',
                'productsCount' => count($data['products'] ?? []),
                'transactionsCount' => count($data['transactions'] ?? []),
                'expensesCount' => count($data['expenses'] ?? [])
            ]);
        } catch (Exception $err) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Gagal bulk upload: ' . $err->getMessage()]);
        }
        break;

    case 'bulk_download':
        $products = $pdo->query("SELECT * FROM `products`")->fetchAll();
        $transactions = $pdo->query("SELECT * FROM `transactions`")->fetchAll();
        $expenses = $pdo->query("SELECT * FROM `expenses`")->fetchAll();

        // Format items_json kembali ke array
        foreach ($transactions as &$tx) {
            $tx['items'] = json_decode($tx['items_json'], true) ?? [];
            unset($tx['items_json']);
        }

        echo json_encode([
            'success' => true,
            'products' => $products,
            'transactions' => $transactions,
            'expenses' => $expenses,
            'categories' => []
        ]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Action tidak dikenali. Gunakan ping, save_transaction, save_product, bulk_upload, bulk_download']);
        break;
}
